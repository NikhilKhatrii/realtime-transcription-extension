import asyncio
import websockets
from model_loader import load_whisper_model
from inference import StreamingTranscriber

# Loading the model globally when the server starts
GLOBAL_MODEL = load_whisper_model()

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

async def main():
  async with websockets.serve(
    transcribe_handler, 
    "localhost", 
    8765,
    max_size=10**7,
    ping_interval=None,
    compression=None ):
    
    print("WebSocket server started at ws://localhost:8765")
    await asyncio.Future()

if __name__ == "__main__":
  asyncio.run(main())