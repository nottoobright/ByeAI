import os
import sys
from sqlalchemy import create_engine, text, inspect
from sqlalchemy.orm import sessionmaker
from datetime import datetime

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://byeai_user:Alskdjfh123!@localhost/byeai")

def get_engine():
    return create_engine(DATABASE_URL)

def check_column_exists(engine, table_name, column_name):
    inspector = inspect(engine)
    columns = [col['name'] for col in inspector.get_columns(table_name)]
    return column_name in columns

def check_table_exists(engine, table_name):
    inspector = inspect(engine)
    return table_name in inspector.get_table_names()

def run_migration():
    print("Starting ByeAI database migration...")
    engine = get_engine()
    
    with engine.connect() as conn:
        trans = conn.begin()
        
        try:
            print("Checking existing schema...")
            
            if not check_table_exists(engine, 'users'):
                print("Creating users table...")
                conn.execute(text("""
                    CREATE TABLE users (
                        client_hash VARCHAR NOT NULL,
                        reputation_points INTEGER NOT NULL DEFAULT 1,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        PRIMARY KEY (client_hash)
                    )
                """))
            else:
                print("Users table exists, checking columns...")
                
                if not check_column_exists(engine, 'users', 'created_at'):
                    print("Adding created_at column to users table...")
                    conn.execute(text("""
                        ALTER TABLE users 
                        ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    """))
                
                print("Updating reputation_points default and existing values...")
                conn.execute(text("""
                    ALTER TABLE users ALTER COLUMN reputation_points SET DEFAULT 1
                """))
                conn.execute(text("""
                    UPDATE users SET reputation_points = 1 WHERE reputation_points = 0
                """))
            
            if not check_table_exists(engine, 'videos'):
                print("Creating videos table...")
                conn.execute(text("""
                    CREATE TABLE videos (
                        video_id VARCHAR NOT NULL,
                        score DOUBLE PRECISION NOT NULL DEFAULT 0.0,
                        view_count BIGINT NOT NULL DEFAULT 0,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        PRIMARY KEY (video_id)
                    )
                """))
            else:
                print("Videos table exists, checking columns...")
                
                if not check_column_exists(engine, 'videos', 'created_at'):
                    print("Adding created_at column to videos table...")
                    conn.execute(text("""
                        ALTER TABLE videos 
                        ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    """))
                
                if not check_column_exists(engine, 'videos', 'updated_at'):
                    print("Adding updated_at column to videos table...")
                    conn.execute(text("""
                        ALTER TABLE videos 
                        ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    """))
            
            if not check_table_exists(engine, 'votes'):
                print("Creating votes table...")
                conn.execute(text("""
                    CREATE TABLE votes (
                        id SERIAL PRIMARY KEY,
                        user_hash VARCHAR REFERENCES users(client_hash),
                        video_id VARCHAR REFERENCES videos(video_id),
                        category VARCHAR NOT NULL,
                        timestamp BIGINT NOT NULL
                    )
                """))
            else:
                print("Votes table exists, no changes needed...")
            
            if not check_table_exists(engine, 'reputation_logs'):
                print("Creating reputation_logs table...")
                conn.execute(text("""
                    CREATE TABLE reputation_logs (
                        id SERIAL PRIMARY KEY,
                        user_hash VARCHAR REFERENCES users(client_hash),
                        old_reputation INTEGER NOT NULL,
                        new_reputation INTEGER NOT NULL,
                        reason TEXT,
                        timestamp BIGINT NOT NULL
                    )
                """))
            else:
                print("Reputation_logs table exists, no changes needed...")
            
            print("Creating indexes for performance...")
            conn.execute(text("""
                CREATE INDEX IF NOT EXISTS idx_users_client_hash ON users(client_hash)
            """))
            conn.execute(text("""
                CREATE INDEX IF NOT EXISTS idx_videos_video_id ON videos(video_id)
            """))
            conn.execute(text("""
                CREATE INDEX IF NOT EXISTS idx_votes_user_hash ON votes(user_hash)
            """))
            conn.execute(text("""
                CREATE INDEX IF NOT EXISTS idx_votes_video_id ON votes(video_id)
            """))
            conn.execute(text("""
                CREATE INDEX IF NOT EXISTS idx_reputation_logs_user_hash ON reputation_logs(user_hash)
            """))
            
            trans.commit()
            print("Migration completed successfully!")
            
        except Exception as e:
            trans.rollback()
            print(f"Migration failed: {e}")
            raise

def verify_migration():
    print("\nVerifying migration results...")
    engine = get_engine()
    
    with engine.connect() as conn:
        tables = ['users', 'videos', 'votes', 'reputation_logs']
        
        for table in tables:
            result = conn.execute(text(f"SELECT COUNT(*) FROM {table}"))
            count = result.scalar()
            print(f"Table '{table}': {count} rows")
        
        print("\nColumn verification:")
        for table in ['users', 'videos']:
            result = conn.execute(text(f"""
                SELECT column_name, data_type, is_nullable, column_default
                FROM information_schema.columns 
                WHERE table_name = '{table}'
                ORDER BY ordinal_position
            """))
            
            print(f"\n{table.upper()} table columns:")
            for row in result:
                print(f"  - {row[0]} ({row[1]}) {'NULL' if row[2] == 'YES' else 'NOT NULL'} {f'DEFAULT {row[3]}' if row[3] else ''}")

if __name__ == "__main__":
    try:
        run_migration()
        verify_migration()
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
