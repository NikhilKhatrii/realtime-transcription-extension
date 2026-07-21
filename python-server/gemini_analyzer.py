import os
from dotenv import load_dotenv
from google import genai

# Load API key from .env file
load_dotenv()

def analyze_interview(transcript: str) -> str:
    """
    Sends the full interview transcript to Gemini 2.5 Flash
    and returns a hiring recommendation.
    """
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return "⚠️ Error: GEMINI_API_KEY is not set. Please add your API key to the .env file in the python-server directory."

    client = genai.Client(api_key=api_key)

    prompt = f"""You are an expert HR analyst. You have been given the full transcript of a job interview between an interviewer and an interviewee (candidate).

Analyze the transcript and provide a structured hiring recommendation. Your response should include:

1.  **Overall Recommendation**: Clearly state **HIRE**, **NO HIRE**, or **MAYBE (Needs Further Evaluation)**.
2.  **Confidence Level**: How confident are you in this recommendation (Low / Medium / High)?
3.  **Candidate Strengths**: List 3-5 key strengths demonstrated by the candidate during the interview.
4.  **Areas of Concern**: List any red flags or weaknesses observed.
5.  **Communication Skills**: Rate the candidate's communication (Excellent / Good / Average / Poor) with a brief justification.
6.  **Technical/Domain Knowledge**: If applicable, assess the depth of their knowledge based on their answers.
7.  **Summary**: A 2-3 sentence overall summary of the candidate's performance.

If the transcript is too short, unclear, or does not appear to be an interview, state that clearly and provide whatever analysis you can.

--- INTERVIEW TRANSCRIPT ---
{transcript}
--- END TRANSCRIPT ---"""

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
    )

    return response.text
