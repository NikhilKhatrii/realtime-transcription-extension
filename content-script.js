// This wrapper ensures the script's logic runs only once, even if it's
// injected multiple times into the same tab.
if (typeof window.transcriberContentScriptLoaded === 'undefined') {
  window.transcriberContentScriptLoaded = true;

  // --- STATE VARIABLES ---
  let captionOverlay = null;
  let captionContainer = null;
  let fullTranscript = ""; // A single string to hold the entire transcript buffer
  let hideTimeout = null; // Timeout variable to hide captions after inactivity

  // --- DEFAULT SETTINGS (will be overwritten by dashboard) ---
  let captionSettings = {
    fontSize: '20',
    textColor: '#FFFFFF',
    backgroundOpacity: '0.8',
    maxLines: 3
  };

  // --- MESSAGE LISTENER from dashboard ---
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'SETUP_OVERLAY':
        captionSettings = message.settings;
        setupCaptionOverlay();
        break;
      case 'UPDATE_STYLE':
        captionSettings = message.settings;
        applyStyles();
        updateCaptionDisplay(); // Re-render captions with new settings
        break;
      case 'SHOW_CAPTION':
        // 1. Clear any existing timeout because new text has just arrived.
        if (hideTimeout) {
          clearTimeout(hideTimeout);
        }

        // 2. Append new text to the buffer and update the display.
        fullTranscript += message.text + " ";
        updateCaptionDisplay();

        // 3. Set a new timeout to clear the captions after a pause in speech.
        hideTimeout = setTimeout(() => {
          fullTranscript = ""; // Empty the transcript buffer
          updateCaptionDisplay(); // Update the display to be empty and hidden
        }, 3000); // 3-second pause will clear the text.
        break;
      case 'REMOVE_OVERLAY':
        removeCaptionOverlay();
        break;
    }
  });

  // --- CORE FUNCTIONS ---
  function setupCaptionOverlay() {
    // Find and remove any old overlay that might be lingering from a previous session.
    const oldOverlay = document.getElementById('transcription-overlay');
    if (oldOverlay) {
      oldOverlay.remove();
    }

    // Reset state variables
    fullTranscript = "";
    if (hideTimeout) clearTimeout(hideTimeout); // Clear any lingering timeout

    captionOverlay = document.createElement('div');
    captionOverlay.id = 'transcription-overlay';
    captionOverlay.style.cssText = `
            position: fixed;
            bottom: 5%;
            left: 50%;
            transform: translateX(-50%);
            z-index: 999999;
            pointer-events: none;
            width: 80%;
            max-width: 900px;
            min-width: 300px;
            display: flex;
            justify-content: center;
            align-items: center;
        `;
    captionContainer = document.createElement('div');
    captionContainer.style.cssText = `
            padding: 12px 20px;
            border-radius: 8px;
            text-align: center;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
            backdrop-filter: blur(5px);
            -webkit-backdrop-filter: blur(5px);
            transition: opacity 0.3s ease-in-out;
            opacity: 0;
        `;
    applyStyles(); // Apply initial styles from settings

    captionOverlay.appendChild(captionContainer);
    document.body.appendChild(captionOverlay);
  }

  function applyStyles() {
    if (!captionContainer) return;

    captionContainer.style.fontSize = `${captionSettings.fontSize}px`;
    captionContainer.style.color = captionSettings.textColor;
    captionContainer.style.backgroundColor = `rgba(0, 0, 0, ${captionSettings.backgroundOpacity})`;
    captionContainer.style.lineHeight = `calc(${captionSettings.fontSize}px * 1.4)`;
  }

  /**
   * This function now contains all the logic for displaying captions.
   * It wraps long text into lines and handles the "start fresh" logic
   * when the maximum number of lines is exceeded.
   */
  function updateCaptionDisplay() {
    if (!captionContainer) return;

    // Define a rough character limit per line for wrapping.
    const charsPerLine = 70;

    const words = fullTranscript.trim().split(/\s+/);
    let lines = [];
    let currentLine = "";

    for (const word of words) {
      // If adding the next word exceeds the line length, push the current line and start a new one.
      if ((currentLine + " " + word).trim().length > charsPerLine && currentLine.length > 0) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine += " " + word;
      }
    }
    // Add the last line that was being built
    if (currentLine.trim() !== "") {
      lines.push(currentLine.trim());
    }

    const max = parseInt(captionSettings.maxLines, 10);

    // Check if the number of generated lines exceeds the maximum allowed.
    if (lines.length > max) {
      // "Start Fresh": This logic discards old lines and starts over.
      lines = lines.slice(max);
      // We MUST also reset the underlying transcript buffer to match what's on screen.
      // This prevents the buffer from growing infinitely and slowing down the script.
      fullTranscript = lines.join(" ") + " ";
    }

    captionContainer.innerHTML = lines.join('<br>');

    // Make the container visible if it has text, otherwise hide it.
    if (fullTranscript.trim().length > 0) {
      captionContainer.style.opacity = '1';
    } else {
      captionContainer.style.opacity = '0';
    }
  }

  function removeCaptionOverlay() {
    if (captionOverlay) {
      if (hideTimeout) clearTimeout(hideTimeout); // Clean up the timeout
      captionOverlay.remove();
      captionOverlay = null;
      captionContainer = null;
      fullTranscript = "";
    }
  }
}

