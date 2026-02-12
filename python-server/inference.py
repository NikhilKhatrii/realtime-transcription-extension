import asyncio
import numpy as np
from scipy.signal import resample_poly
import config

def fast_resample_scipy(audio, orig_sr, target_sr):
  """Fast resampling using scipy."""
  if orig_sr == target_sr:
    return audio
    
  gcd = np.gcd(orig_sr, target_sr)
  up = target_sr // gcd
  down = orig_sr // gcd
    
  resampled = resample_poly(audio, up, down)
  return resampled.astype(np.float32)

def alternative_resample_simple(audio, orig_sr, target_sr):
  """Simple decimation resampling (ultra-fast)."""
  if orig_sr == target_sr:
    return audio
    
  ratio = orig_sr // target_sr
  if ratio == 3 and orig_sr == 48000 and target_sr == 16000:
    return audio[::3].astype(np.float32)
    
  return fast_resample_scipy(audio, orig_sr, target_sr)

class StreamingTranscriber:
  def __init__(self, websocket, model, use_simple_resampling=False):
    self.websocket = websocket
    self.model = model  # Model is passed in from server.py
    self.audio_stream = bytearray()
    self.processing_task = None
    self.use_simple_resampling = use_simple_resampling
        
  async def add_audio_data(self, audio_data):
    """Continuously add audio data"""
    self.audio_stream.extend(audio_data)
        
    if self.processing_task is None or self.processing_task.done():
      self.processing_task = asyncio.create_task(self.continuous_processing())
    
  async def continuous_processing(self):
    """Process audio continuously as it arrives"""
    while len(self.audio_stream) > 0:
      await asyncio.sleep(0.1)
      if len(self.audio_stream) < config.MIN_CHUNK_SIZE:
        continue
                
      audio_data = bytes(self.audio_stream)
      self.audio_stream = bytearray()
            
      try:
        audio_np = np.frombuffer(audio_data, dtype=np.float32)
        if np.max(np.abs(audio_np)) < 0.001:
          continue
                
        # Resampling logic
        if self.use_simple_resampling:
          audio_resampled = alternative_resample_simple(
            audio_np, config.BROWSER_SAMPLE_RATE, config.WHISPER_SAMPLE_RATE)
        else:
          audio_resampled = fast_resample_scipy(
            audio_np, config.BROWSER_SAMPLE_RATE, config.WHISPER_SAMPLE_RATE)
                
        # Transcribe logic
        segments, info = self.model.transcribe(
          audio_resampled,
          best_of=1,
          beam_size=1,
          condition_on_previous_text=True,
          vad_filter=True,
          vad_parameters=dict(
            min_silence_duration_ms=100,
            threshold=0.5,
            min_speech_duration_ms=100
          ),
          no_speech_threshold=0.9,
          compression_ratio_threshold=1.5,
          log_prob_threshold=-0.5,
          temperature=0.2,
        )
                
        full_text = "".join([segment.text for segment in segments]).strip()
        if 'thank you' in full_text.lower() and len(full_text) < 11:
          continue 
        elif full_text and (len(full_text) < 50):
          await self.websocket.send(full_text)
          print(f"Stream: {full_text}")
      except Exception as e:
        print(f"Stream processing error: {e}")