// --- UI ELEMENTS ---
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const audioSourceSelect = document.getElementById('audioSource');
const transcriptionText = document.getElementById('transcriptionText');
const overlayToggle = document.getElementById('overlayToggle');
const selectTabButton = document.getElementById('selectTabButton'); // Added button

// --- NEW CAPTION SETTINGS UI ELEMENTS ---
const fontSizeInput = document.getElementById('fontSize');
const fontSizeValue = document.getElementById('fontSizeValue');
const textColorInput = document.getElementById('textColor');
const bgOpacityInput = document.getElementById('bgOpacity');
const bgOpacityValue = document.getElementById('bgOpacityValue');
const maxLinesInput = document.getElementById('maxLines');

// --- GEMINI ANALYSIS UI ELEMENTS ---
const analyzeButton = document.getElementById('analyzeButton');
const analysisResult = document.getElementById('analysisResult');
const transcriptCounter = document.getElementById('transcriptCounter');


// --- STATE VARIABLES ---
let websocket;
let audioContext;
let audioStream;
let workletNode;
let currentTabId = null;
let overlayEnabled = false;

// Full session transcript — accumulates ALL text for Gemini analysis
let fullSessionTranscript = "";

// --- CAPTION SETTINGS STATE ---
let captionSettings = {
  fontSize: fontSizeInput.value,
  textColor: textColorInput.value,
  backgroundOpacity: bgOpacityInput.value,
  maxLines: maxLinesInput.value,
};

// --- HELPER FUNCTION TO ROBUSTLY SEND MESSAGES ---
async function sendMessageToTab(tabId, message) {
  if (!tabId) {
    console.warn("Attempted to send a message with no valid tabId.");
    return;
  }
  try {
    // Injecting the script every time is a safeguard against the content script being unloaded.
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content-script.js'],
    });
    await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    console.error(`Could not send message to tab ${tabId}. The tab might be a protected page (e.g., chrome://) or may need to be refreshed.`, error);
  }
}


//CORE FUNCTIONS

async function startTranscription() {
  stopTranscription();

  // Reset the session transcript for a new session
  fullSessionTranscript = "";
  updateTranscriptCounter();
  
  // Clear previous analysis results
  analysisResult.classList.remove('visible', 'error');
  analysisResult.textContent = '';

  // Clear the live transcription display
  transcriptionText.innerHTML = 'Your live transcription will appear here...';

  try {
    const audioSource = audioSourceSelect.value;

    if (audioSource === 'microphone') {
      audioStream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 48000, channelCount: 1, echoCancellation: true }
      });
    } else if (audioSource === 'tab') {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        alert("Error: No audio track found. Did you check 'Share tab audio'?");
        stream.getVideoTracks().forEach(track => track.stop()); // Clean up video track
        return;
      }
      stream.getVideoTracks().forEach(track => track.stop());
      audioStream = new MediaStream([audioTracks[0]]);
      await getCurrentTab();
    }

    websocket = new WebSocket('ws://localhost:8765');

    websocket.onopen = async () => {
      console.log("WebSocket connection established.");
      audioContext = new AudioContext({ sampleRate: 48000 });
      await audioContext.audioWorklet.addModule('audio-processor.js');
      workletNode = new AudioWorkletNode(audioContext, 'audio-processor');

      workletNode.port.onmessage = (event) => {
        if (websocket && websocket.readyState === WebSocket.OPEN) {
          websocket.send(event.data);
        }
      };

      const source = audioContext.createMediaStreamSource(audioStream);
      source.connect(workletNode);

      if (audioSource === 'tab' && overlayEnabled && currentTabId) {
        setupOverlay();
      }
    };

    websocket.onmessage = (event) => {
      transcriptionText.innerHTML += `<div>${event.data}</div>`;
      transcriptionText.scrollTop = transcriptionText.scrollHeight;
      
      // Accumulate the full transcript for Gemini analysis
      fullSessionTranscript += event.data + " ";
      updateTranscriptCounter();
      
      if (overlayEnabled && currentTabId && audioSourceSelect.value === 'tab') {
        sendCaptionToTab(event.data);
      }
    };

    websocket.onerror = (error) => {
      console.error("WebSocket error:", error);
      alert("Failed to connect to transcription server. Make sure Python server is running.");
    };

    websocket.onclose = () => {
      console.log("WebSocket connection closed.");
    }

  } catch (err) {
    console.error("Error starting audio capture:", err);
  }
}

function stopTranscription() {
  if (audioStream) audioStream.getTracks().forEach(track => track.stop());
  if (workletNode) workletNode.disconnect();
  if (audioContext && audioContext.state !== 'closed') audioContext.close();
  if (websocket) websocket.close();
  if (currentTabId && overlayEnabled) removeOverlay();
  // We don't reset currentTabId here so the user can restart without re-selecting a tab
  // We also don't reset fullSessionTranscript — it persists so the user can analyze it
}


// --- OVERLAY & CAPTION FUNCTIONS ---

async function getCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    // Make sure the active tab is not our own dashboard
    if (tab && !tab.url.includes('dashboard.html')) {
      currentTabId = tab.id;
    } else {
      // Fallback: find the first tab that is making sound and is not the dashboard
      const tabs = await chrome.tabs.query({ audible: true });
      const nonDashboardAudibleTabs = tabs.filter(t => !t.url.includes('dashboard.html'));
      if (nonDashboardAudibleTabs.length > 0) {
        currentTabId = nonDashboardAudibleTabs[0].id;
      }
    }
  } catch (error) {
    console.error("Error getting current tab:", error);
  }
}

function setupOverlay() {
  sendMessageToTab(currentTabId, { type: 'SETUP_OVERLAY', settings: captionSettings });
}

function removeOverlay() {
  sendMessageToTab(currentTabId, { type: 'REMOVE_OVERLAY' });
}

function sendCaptionToTab(text) {
  sendMessageToTab(currentTabId, { type: 'SHOW_CAPTION', text: text });
}

function updateOverlayStyle() {
  if (overlayEnabled && currentTabId) {
    sendMessageToTab(currentTabId, { type: 'UPDATE_STYLE', settings: captionSettings });
  }
}


// --- GEMINI ANALYSIS FUNCTIONS ---

function updateTranscriptCounter() {
  const wordCount = fullSessionTranscript.trim() ? fullSessionTranscript.trim().split(/\s+/).length : 0;
  transcriptCounter.textContent = `${wordCount} word${wordCount !== 1 ? 's' : ''} captured`;
  
  // Enable/disable the analyze button based on whether we have transcript text
  analyzeButton.disabled = wordCount === 0;
}

async function analyzeWithGemini() {
  if (!fullSessionTranscript.trim()) {
    analysisResult.textContent = "No transcript to analyze. Start a transcription session first.";
    analysisResult.classList.add('visible', 'error');
    return;
  }

  // Set loading state
  analyzeButton.disabled = true;
  analyzeButton.innerHTML = '<span class="spinner"></span> Analyzing with Gemini...';
  analysisResult.classList.remove('visible', 'error');
  analysisResult.textContent = '';

  try {
    const response = await fetch('http://localhost:8080/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: fullSessionTranscript.trim() }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `Server returned ${response.status}`);
    }

    // Render the analysis result with basic markdown-to-HTML conversion
    analysisResult.innerHTML = renderMarkdown(data.analysis);
    analysisResult.classList.add('visible');
    analysisResult.classList.remove('error');

  } catch (error) {
    console.error("Gemini analysis failed:", error);
    analysisResult.textContent = `Analysis failed: ${error.message}. Make sure the Python server is running and your Gemini API key is set in the .env file.`;
    analysisResult.classList.add('visible', 'error');
  } finally {
    // Restore button state
    analyzeButton.disabled = false;
    analyzeButton.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width:18px;height:18px;">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
      </svg>
      Analyze Interview with Gemini
    `;
    updateTranscriptCounter();
  }
}

/**
 * Simple markdown-to-HTML renderer for Gemini's response.
 * Handles bold, headers, and list items for a clean display.
 */
function renderMarkdown(text) {
  if (!text) return '';
  
  return text
    // Headers
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // List items
    .replace(/^[-*] (.+)$/gm, '• $1')
    // Line breaks
    .replace(/\n/g, '<br>');
}


// --- EVENT LISTENERS ---

startButton.addEventListener('click', startTranscription);
stopButton.addEventListener('click', stopTranscription);
analyzeButton.addEventListener('click', analyzeWithGemini);

overlayToggle.addEventListener('change', (e) => {
  overlayEnabled = e.target.checked;
  if (overlayEnabled && currentTabId && audioSourceSelect.value === 'tab') {
    setupOverlay();
  } else if (!overlayEnabled && currentTabId) {
    removeOverlay();
  }
});

// --- MANUAL TAB SELECTION LOGIC ---
selectTabButton.addEventListener('click', async () => {
  try {
    // Query for tabs that can be scripted
    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
    const otherTabs = tabs.filter(tab => !tab.url.includes('dashboard.html'));

    if (otherTabs.length > 0) {
      const tabTitles = otherTabs.map((tab, index) => `${index + 1}: ${tab.title}`);
      const selection = prompt(`Select the tab for the caption overlay:\n\n${tabTitles.join('\n')}\n\nEnter number:`);

      if (selection === null) return; // User cancelled prompt

      const tabIndex = parseInt(selection) - 1;

      if (!isNaN(tabIndex) && tabIndex >= 0 && tabIndex < otherTabs.length) {
        currentTabId = otherTabs[tabIndex].id;
        console.log("Manually selected tab for overlay:", otherTabs[tabIndex].title);

        if (overlayEnabled) {
          setupOverlay(); // Re-setup overlay on the new tab
        }
      } else {
        alert("Invalid selection. Please enter a number from the list.");
      }
    } else {
      alert("No other scriptable tabs found to select.");
    }
  } catch (error) {
    console.error("Error during manual tab selection:", error);
  }
});


// --- EVENT LISTENERS FOR CAPTION SETTINGS ---

fontSizeInput.addEventListener('input', (e) => {
  captionSettings.fontSize = e.target.value;
  fontSizeValue.textContent = `${e.target.value}px`;
  updateOverlayStyle();
});

textColorInput.addEventListener('input', (e) => {
  captionSettings.textColor = e.target.value;
  updateOverlayStyle();
});

bgOpacityInput.addEventListener('input', (e) => {
  captionSettings.backgroundOpacity = e.target.value;
  bgOpacityValue.textContent = `${Math.round(e.target.value * 100)}%`;
  updateOverlayStyle();
});

maxLinesInput.addEventListener('input', (e) => {
  captionSettings.maxLines = e.target.value;
  updateOverlayStyle();
});
