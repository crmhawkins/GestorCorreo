import asyncio
from app.database import AsyncSessionLocal
from sqlalchemy import select
from app.models import Account

async def check_db():
    print("Checking DB...")
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Account))
            accounts = result.scalars().all()
            print(f"Accounts found: {len(accounts)}")
            print("DB check passed.")
    except Exception as e:
        print(f"DB Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(check_db())
