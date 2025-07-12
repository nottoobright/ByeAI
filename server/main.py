import os
import math
import logging
from datetime import datetime
from typing import Dict, List, Optional
from dotenv import load_dotenv
from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import and_, func
from pydantic import BaseModel
import httpx

load_dotenv()

from . import models, database

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

models.Base.metadata.create_all(bind=database.engine)

app = FastAPI(title="ByeAI API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class VoteRequest(BaseModel):
    videoId: str
    category: str
    clientHash: str
    timestamp: int
    viewCount: int = 0
    flagSource: str = "unknown"
    analytics: Optional[dict] = None

class FlagsResponse(BaseModel):
    videos: List[dict]

class YouTubeService:
    def __init__(self):
        self.api_key = os.getenv('YOUTUBE_API_KEY')
        if not self.api_key:
            logger.warning("YOUTUBE_API_KEY not set, API calls will fail")
        self.base_url = "https://www.googleapis.com/youtube/v3"
        self.daily_requests = 0
        self.last_reset = datetime.now()
        self.max_daily_requests = 9000
    
    def can_make_request(self) -> bool:
        self._reset_daily_counter()
        return self.daily_requests < self.max_daily_requests
    
    def record_request(self):
        self._reset_daily_counter()
        self.daily_requests += 1
        logger.info(f"API requests today: {self.daily_requests}/{self.max_daily_requests}")
    
    def _reset_daily_counter(self):
        now = datetime.now()
        if now.date() > self.last_reset.date():
            self.daily_requests = 0
            self.last_reset = now
    
    async def get_view_count(self, video_id: str) -> int:
        if not self.api_key:
            return 100000
        
        if not self.can_make_request():
            logger.warning("YouTube API quota limit reached")
            return 100000
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/videos",
                    params={
                        "part": "statistics",
                        "id": video_id,
                        "key": self.api_key
                    },
                    timeout=10.0
                )
                
                self.record_request()
                
                if response.status_code == 200:
                    data = response.json()
                    if data.get("items"):
                        stats = data["items"][0]["statistics"]
                        if "viewCount" in stats:
                            return int(stats["viewCount"])
                    return 0
                elif response.status_code == 403:
                    logger.error("YouTube API quota exceeded")
                    return 100000
                else:
                    logger.error(f"YouTube API error: {response.status_code}")
                    return 100000
                    
        except Exception as e:
            logger.error(f"Error fetching video statistics: {str(e)}")
            return 100000

youtube_service = YouTubeService()

def get_user_reputation_score(rep_points: int) -> float:
    return 1 + math.log2(max(1, rep_points))

def calculate_threshold(view_count: int) -> int:
    return max(15, math.ceil(0.05 * math.sqrt(view_count)))

def update_user_reputations(video_id: str, db: Session) -> None:
    video = db.query(models.Video).filter(models.Video.video_id == video_id).first()
    if not video:
        return
    
    threshold = calculate_threshold(video.view_count)
    votes = db.query(models.Vote).filter(models.Vote.video_id == video_id).all()
    
    video_flagged = video.score >= threshold
    
    for vote in votes:
        user = db.query(models.User).filter(models.User.client_hash == vote.user_hash).first()
        if not user:
            continue
            
        old_reputation = user.reputation_points
        
        if video_flagged:
            user.reputation_points += 1
        else:
            if video.score < -2:
                user.reputation_points -= 1
                
        user.reputation_points = max(1, user.reputation_points)
        
        if user.reputation_points != old_reputation:
            db.add(models.ReputationLog(
                user_hash=user.client_hash,
                old_reputation=old_reputation,
                new_reputation=user.reputation_points,
                reason=f"Consensus update for video {video_id}",
                timestamp=int(datetime.now().timestamp())
            ))
    
    db.commit()
    
async def track_plausible_event(payload: dict, request: Request):
    plausible_domain = os.getenv("PLAUSIBLE_DOMAIN")
    if not plausible_domain:
        logger.warning("PLAUSIBLE_DOMAIN not set, skipping analytics.")
        return

    try:
        headers = {
            "User-Agent": request.headers.get("user-agent"),
            "X-Forwarded-For": request.client.host,
            "Content-Type": "application/json"
        }
        
        event_data = {
            "name": payload.get("name", "vote"),
            "url": "app://youtube.com/" + payload.get("path", ""),
            "domain": plausible_domain,
            "props": payload.get("props", {})
        }

        async with httpx.AsyncClient() as client:
            response = await client.post("https://plausible.io/api/event", json=event_data, headers=headers)
            if response.status_code != 202:
                logger.error(f"Plausible API error: {response.status_code} - {response.text}")

    except Exception as e:
        logger.error(f"Failed to send event to Plausible: {e}")

@app.post("/vote")
async def submit_vote(vote_req: VoteRequest, request: Request, db: Session = Depends(database.get_db), 
                     background_tasks: BackgroundTasks = BackgroundTasks()):
    
        # Track event if analytics are enabled
    if vote_req.analytics:
        background_tasks.add_task(track_plausible_event, vote_req.analytics, request)
        
    user = db.query(models.User).filter(models.User.client_hash == vote_req.clientHash).first()
    if not user:
        user = models.User(client_hash=vote_req.clientHash, reputation_points=1)
        db.add(user)
        db.flush()
    
    view_count = vote_req.viewCount
    
    if vote_req.flagSource in ["thumbnail", "context_menu"] and view_count == 0:
        try:
            api_view_count = await youtube_service.get_view_count(vote_req.videoId)
            if api_view_count > 0:
                view_count = api_view_count
            else:
                view_count = 100000
                logger.warning(f"Failed to get view count for {vote_req.videoId}, using default")
        except Exception as e:
            logger.error(f"YouTube API error for {vote_req.videoId}: {str(e)}")
            view_count = 100000
    
    video = db.query(models.Video).filter(models.Video.video_id == vote_req.videoId).first()
    if not video:
        video = models.Video(
            video_id=vote_req.videoId, 
            view_count=view_count,
            score=0.0
        )
        db.add(video)
        db.flush()
    else:
        if view_count > video.view_count:
            video.view_count = view_count

    existing_vote = db.query(models.Vote).filter(
        and_(
            models.Vote.user_hash == user.client_hash,
            models.Vote.video_id == video.video_id
        )
    ).first()

    if existing_vote:
        raise HTTPException(status_code=409, detail="User has already voted on this video")

    new_vote = models.Vote(
        user_hash=user.client_hash,
        video_id=video.video_id,
        category=vote_req.category,
        timestamp=vote_req.timestamp
    )
    db.add(new_vote)
    
    user_reputation_weight = get_user_reputation_score(user.reputation_points)
    video.score += user_reputation_weight
    
    threshold = calculate_threshold(video.view_count)
    
    db.commit()
    
    background_tasks.add_task(update_user_reputations, video.video_id, db)
    
    return {
        "status": "success",
        "new_score": video.score,
        "threshold": threshold,
        "is_flagged": video.score >= threshold,
        "user_reputation": user.reputation_points,
        "view_count_source": "api" if vote_req.flagSource in ["thumbnail", "context_menu"] else "dom"
    }

@app.get("/flags", response_model=FlagsResponse)
def get_flags(ids: str, db: Session = Depends(database.get_db)):
    video_ids = ids.split(',')
    flagged_videos = []
    
    videos = db.query(models.Video).filter(models.Video.video_id.in_(video_ids)).all()
    
    for video in videos:
        threshold = calculate_threshold(video.view_count)
        if video.score >= threshold:
            category_counts = db.query(
                models.Vote.category, 
                func.count(models.Vote.category).label('count')
            ).filter(
                models.Vote.video_id == video.video_id
            ).group_by(models.Vote.category).order_by(func.count(models.Vote.category).desc()).all()
            
            most_common_category = category_counts[0][0] if category_counts else "Other"
            
            flagged_videos.append({
                "id": video.video_id,
                "category": most_common_category,
                "score": video.score,
                "threshold": threshold,
                "vote_count": len(video.votes)
            })
            
    return {"videos": flagged_videos}

@app.get("/video/{video_id}/stats")
def get_video_stats(video_id: str, db: Session = Depends(database.get_db)):
    video = db.query(models.Video).filter(models.Video.video_id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    
    threshold = calculate_threshold(video.view_count)
    votes_by_category = db.query(
        models.Vote.category, 
        func.count(models.Vote.category).label('count')
    ).filter(
        models.Vote.video_id == video_id
    ).group_by(models.Vote.category).all()
    
    return {
        "video_id": video_id,
        "score": video.score,
        "threshold": threshold,
        "is_flagged": video.score >= threshold,
        "view_count": video.view_count,
        "total_votes": len(video.votes),
        "votes_by_category": dict(votes_by_category)
    }

@app.get("/api/quota-status")
async def get_quota_status():
    return {
        "requests_used": youtube_service.daily_requests,
        "requests_remaining": youtube_service.max_daily_requests - youtube_service.daily_requests,
        "quota_percentage": (youtube_service.daily_requests / youtube_service.max_daily_requests) * 100
    }
