import asyncio
import json
import websockets
from aiohttp import web
from aiohttp_cors import setup as cors_setup, ResourceOptions
from model_loader import load_whisper_model
from inference import StreamingTranscriber
from gemini_analyzer import analyze_interview

# Loading the model globally when the server starts
GLOBAL_MODEL = load_whisper_model()

# --- WebSocket Handler (unchanged) ---

async def transcribe_handler(websocket):
  print("Client connected.")
    
  # Initialize the transcriber with the socket and the loaded model
  transcriber = StreamingTranscriber(
    websocket, 
    model=GLOBAL_MODEL, 
    use_simple_resampling=False
    )
    
  try:
    async for message in websocket:
      await transcriber.add_audio_data(message)
            
  except websockets.exceptions.ConnectionClosedOK:
    print("Client disconnected.")
  except Exception as e:
    print(f"An error occurred: {e}")

# --- HTTP Handler for Gemini Analysis ---

async def analyze_handler(request):
  """Receives the full transcript and returns Gemini's hiring analysis."""
  try:
    data = await request.json()
    transcript = data.get("transcript", "")
    
    if not transcript or not transcript.strip():
      return web.json_response(
        {"error": "No transcript provided. Please run a transcription session first."},
        status=400
      )
    
    print(f"Received transcript for analysis ({len(transcript)} chars)...")
    
    # Run the Gemini call in a thread to avoid blocking the event loop
    result = await asyncio.to_thread(analyze_interview, transcript)
    
    print("Gemini analysis complete.")
    return web.json_response({"analysis": result})
    
  except json.JSONDecodeError:
    return web.json_response({"error": "Invalid JSON in request body."}, status=400)
  except Exception as e:
    print(f"Analysis error: {e}")
    return web.json_response({"error": f"Analysis failed: {str(e)}"}, status=500)

async def health_handler(request):
  """Simple health check endpoint."""
  return web.json_response({"status": "ok"})

# --- Server Startup ---

async def main():
  # 1. Start the WebSocket server (existing functionality)
  ws_server = await websockets.serve(
    transcribe_handler, 
    "localhost", 
    8765,
    max_size=10**7,
    ping_interval=None,
    compression=None
  )
  print("WebSocket server started at ws://localhost:8765")
  
  # 2. Start the HTTP server for Gemini analysis
  app = web.Application()
  
  # Setup CORS so the browser extension can call this endpoint
  cors = cors_setup(app, defaults={
    "*": ResourceOptions(
      allow_credentials=True,
      expose_headers="*",
      allow_headers="*",
      allow_methods=["POST", "GET"]
    )
  })
  
  # Add routes
  analyze_route = app.router.add_post("/analyze", analyze_handler)
  health_route = app.router.add_get("/health", health_handler)
  
  # Apply CORS to routes
  cors.add(analyze_route)
  cors.add(health_route)
  
  runner = web.AppRunner(app)
  await runner.setup()
  site = web.TCPSite(runner, "localhost", 8080)
  await site.start()
  print("HTTP server started at http://localhost:8080")
  print("  POST /analyze  — Send transcript for Gemini analysis")
  print("  GET  /health   — Health check")
  
  # Keep both servers running forever
  await asyncio.Future()

if __name__ == "__main__":
  asyncio.run(main())