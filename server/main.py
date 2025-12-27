import os
import re
import math
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from contextlib import contextmanager
from dotenv import load_dotenv
from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import and_, func
from pydantic import BaseModel, field_validator
import httpx
from collections import defaultdict

load_dotenv()

import models
import database

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

models.Base.metadata.create_all(bind=database.engine)

app = FastAPI(title="ByeAI API", version="1.0.0")

# Allowed origins for CORS - Chrome extensions and YouTube
ALLOWED_ORIGINS = [
    "chrome-extension://*",
    "https://www.youtube.com",
    "https://youtube.com",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"^chrome-extension://.*$",
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

# Valid YouTube video ID pattern (11 characters, alphanumeric + dash/underscore)
VIDEO_ID_PATTERN = re.compile(r'^[a-zA-Z0-9_-]{11}$')
# Valid UUID pattern for clientHash
UUID_PATTERN = re.compile(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$', re.IGNORECASE)
# Valid categories (lowercase, kebab-case for consistency)
VALID_CATEGORIES = [
    'ai-general',      # AI used throughout / unsure
    'ai-script',       # AI-written script/content
    'ai-thumbnail',    # AI-generated images/thumbnails
    'ai-music',        # AI-generated music/audio
    'ai-voice',        # AI voice-over / synthetic voice
    'deepfake',        # Deepfake / AI-manipulated video
    'other'            # Other AI usage
]
VALID_FLAG_SOURCES = ['inline_button', 'context_menu', 'popup', 'thumbnail', 'unknown']

class VoteRequest(BaseModel):
    videoId: str
    category: str
    clientHash: str
    timestamp: int
    viewCount: int = 0
    flagSource: str = "unknown"
    analytics: Optional[dict] = None
    
    @field_validator('videoId')
    @classmethod
    def validate_video_id(cls, v):
        if not VIDEO_ID_PATTERN.match(v):
            raise ValueError('Invalid YouTube video ID format')
        return v
    
    @field_validator('clientHash')
    @classmethod
    def validate_client_hash(cls, v):
        if not UUID_PATTERN.match(v):
            raise ValueError('Invalid client hash format')
        return v
    
    @field_validator('category')
    @classmethod
    def validate_category(cls, v):
        if v not in VALID_CATEGORIES:
            raise ValueError(f'Invalid category. Must be one of: {VALID_CATEGORIES}')
        return v
    
    @field_validator('flagSource')
    @classmethod
    def validate_flag_source(cls, v):
        if v not in VALID_FLAG_SOURCES:
            return 'unknown'
        return v

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
        # Circuit breaker for quota management
        self.circuit_breaker_until = None
        self.consecutive_failures = 0
        self.max_failures = 5
    
    def can_make_request(self) -> bool:
        self._reset_daily_counter()
        
        # Check circuit breaker
        if self.circuit_breaker_until and datetime.now() < self.circuit_breaker_until:
            return False
            
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
                    # Reset circuit breaker on successful request
                    self._reset_circuit_breaker()
                    data = response.json()
                    if data.get("items"):
                        stats = data["items"][0]["statistics"]
                        if "viewCount" in stats:
                            return int(stats["viewCount"])
                    return 0
                elif response.status_code == 403:
                    logger.error("YouTube API quota exceeded")
                    self._handle_api_failure()
                    return 100000
                else:
                    logger.error(f"YouTube API error: {response.status_code}")
                    self._handle_api_failure()
                    return 100000
                    
        except Exception as e:
            logger.error(f"Error fetching video statistics: {str(e)}")
            self._handle_api_failure()
            return 100000
    
    def _handle_api_failure(self):
        """Handle API failures and implement circuit breaker"""
        self.consecutive_failures += 1
        if self.consecutive_failures >= self.max_failures:
            # Open circuit breaker for 1 hour
            from datetime import timedelta
            self.circuit_breaker_until = datetime.now() + timedelta(hours=1)
            logger.warning(f"Circuit breaker opened due to {self.consecutive_failures} consecutive failures")
    
    def _reset_circuit_breaker(self):
        """Reset circuit breaker on successful request"""
        if self.consecutive_failures > 0:
            self.consecutive_failures = 0
            self.circuit_breaker_until = None
            logger.info("Circuit breaker reset after successful request")

youtube_service = YouTubeService()

def get_user_reputation_score(rep_points: int) -> float:
    return 1 + math.log2(max(1, rep_points))

def calculate_threshold(view_count: int) -> int:
    return max(15, math.ceil(0.05 * math.sqrt(view_count)))

def update_user_reputations_safe(video_id: str) -> None:
    """Background-safe version that creates its own database session.
    
    This function is called as a background task after a vote is submitted.
    It must create its own session because the request session is closed
    by the time background tasks run.
    """
    from database import get_background_db
    
    with get_background_db() as db:
        video = db.query(models.Video).filter(models.Video.video_id == video_id).first()
        if not video:
            logger.warning(f"Video {video_id} not found for reputation update")
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
        
        # Commit happens automatically via context manager
        logger.info(f"Reputation update completed for video {video_id}")

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

    # Check if user already voted for this specific category on this video
    existing_vote = db.query(models.Vote).filter(
        and_(
            models.Vote.user_hash == user.client_hash,
            models.Vote.video_id == video.video_id,
            models.Vote.category == vote_req.category
        )
    ).first()

    if existing_vote:
        raise HTTPException(status_code=409, detail="User has already voted for this category on this video")

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
    
    # Use background-safe version that creates its own session
    background_tasks.add_task(update_user_reputations_safe, video.video_id)
    
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
    """Get flagged status for a list of video IDs.
    
    Args:
        ids: Comma-separated list of YouTube video IDs (max 100)
    """
    # Input validation
    if not ids or not ids.strip():
        return {"videos": []}
    
    video_ids = [vid.strip() for vid in ids.split(',') if vid.strip()]
    
    # Limit to prevent DoS
    MAX_IDS = 100
    if len(video_ids) > MAX_IDS:
        raise HTTPException(
            status_code=400, 
            detail=f"Maximum {MAX_IDS} video IDs allowed per request"
        )
    
    # Validate each video ID format
    valid_ids = [vid for vid in video_ids if VIDEO_ID_PATTERN.match(vid)]
    
    if not valid_ids:
        return {"videos": []}
    
    flagged_videos = []
    
    videos = db.query(models.Video).filter(models.Video.video_id.in_(valid_ids)).all()
    
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
    # Validate video ID format
    if not VIDEO_ID_PATTERN.match(video_id):
        raise HTTPException(status_code=400, detail="Invalid video ID format")
    
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

@app.get("/health")
async def health_check():
    """Health check endpoint for monitoring and load balancers."""
    return {
        "status": "healthy",
        "version": "1.0.0",
        "timestamp": datetime.now().isoformat()
    }
