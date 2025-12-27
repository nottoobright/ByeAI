from sqlalchemy import Column, String, Integer, BigInteger, Float, ForeignKey, DateTime, Text
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base

class User(Base):
    __tablename__ = "users"
    client_hash = Column(String, primary_key=True, index=True)
    reputation_points = Column(Integer, default=1, nullable=False)
    created_at = Column(DateTime, default=datetime.now)
    
    votes = relationship("Vote", back_populates="user")
    reputation_logs = relationship("ReputationLog", back_populates="user")

class Video(Base):
    __tablename__ = "videos"
    video_id = Column(String, primary_key=True, index=True)
    score = Column(Float, default=0.0, nullable=False)
    view_count = Column(BigInteger, default=0, nullable=False)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)
    
    votes = relationship("Vote", back_populates="video")

class Vote(Base):
    __tablename__ = "votes"
    id = Column(Integer, primary_key=True, index=True)
    user_hash = Column(String, ForeignKey("users.client_hash"), index=True)  # Added index
    video_id = Column(String, ForeignKey("videos.video_id"), index=True)  # Added index
    category = Column(String, nullable=False, index=True)  # Added index for category aggregations
    timestamp = Column(BigInteger, nullable=False)
    
    user = relationship("User", back_populates="votes")
    video = relationship("Video", back_populates="votes")

class ReputationLog(Base):
    __tablename__ = "reputation_logs"
    id = Column(Integer, primary_key=True, index=True)
    user_hash = Column(String, ForeignKey("users.client_hash"))
    old_reputation = Column(Integer, nullable=False)
    new_reputation = Column(Integer, nullable=False)
    reason = Column(Text)
    timestamp = Column(BigInteger, nullable=False)
    
    user = relationship("User", back_populates="reputation_logs")
