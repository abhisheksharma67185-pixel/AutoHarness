import os
import sys
import psycopg2

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

from app.core.settings import get_settings

def get_db_url():
    settings = get_settings()
    url = str(settings.database_url)
    if url.startswith("postgresql+asyncpg://"):
        url = url.replace("postgresql+asyncpg://", "postgresql://")
    return url

def main():
    url = get_db_url()
    conn = psycopg2.connect(url, sslmode="require")
    cur = conn.cursor()
    
    # Get all tables in public schema
    cur.execute("""
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
    """)
    tables = [r[0] for r in cur.fetchall()]
    print("Tables in database:", tables)
    
    for table in tables:
        cur.execute(f"""
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = '{table}'
        """)
        cols = cur.fetchall()
        print(f"\nTable: {table}")
        for col in cols:
            print(f"  - {col[0]}: {col[1]}")
            
    conn.close()

if __name__ == "__main__":
    main()
