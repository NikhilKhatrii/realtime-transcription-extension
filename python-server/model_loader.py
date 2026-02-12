from faster_whisper import WhisperModel
import config

def load_whisper_model():
  """
  Initializes and loads the Whisper model based on config settings.
  """
  print(config.MODEL_SIZE," is loading")
  model = WhisperModel(
    config.MODEL_SIZE, 
    device=config.DEVICE, 
    compute_type=config.COMPUTE_TYPE
  )
  print(config.MODEL_SIZE," is loaded")
  return model