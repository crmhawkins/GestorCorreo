import httpx
import asyncio

async def check_ollama():
    print("Checking Ollama...")
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get("http://localhost:11434/api/tags")
            print(f"Status: {response.status_code}")
            print(f"Response: {response.text[:200]}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(check_ollama())
