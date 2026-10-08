const { mistralJSON } = require('./mistralClient');

async function analyzeResume(resumeText, targetJob) {
    const system = `You are a strict, expert technical recruiter and ATS (Applicant Tracking System) simulator.
You evaluate resumes against a specific target job with realistic, well-calibrated scoring — do not inflate scores.
Always respond with ONLY a valid JSON object matching the exact schema requested. No markdown, no commentary.`;

    const user = `Analyze this resume against the target job title: "${targetJob}".

RESUME TEXT:
"""
${resumeText.slice(0, 6000)}
"""

Return a JSON object with exactly these fields:
{
  "targetJob": string,
  "matchScore": number (0-100, how well the resume matches this specific job),
  "atsScore": number (0-100, how well an ATS would parse/rank this resume: formatting, keywords, structure),
  "decision": "SUITABLE" or "NOT SUITABLE",
  "confidence": number (0-100, your confidence in this decision),
  "summary": string (3-4 sentences, honest assessment),
  "strengths": array of 3-6 short strings (skills/experience that match well),
  "missingSkills": array of 2-6 short strings (important skills/keywords missing for this role),
  "recommendations": array of 3-5 short actionable strings to improve the resume for this role,
  "estimatedAfterImprovement": number (0-100, realistic matchScore if recommendations are applied)
}`;

    return mistralJSON(system, user, { temperature: 0.3, maxTokens: 1200 });
}

async function getJobSuggestions(resumeText) {
    const system = `You are a career advisor. Based on a resume, suggest realistic job titles the candidate is qualified for.
Respond with ONLY valid JSON: {"suggestions": ["Job Title 1", "Job Title 2", ...]}. Provide 8-12 concise, real-world job titles.`;

    const user = `Resume excerpt:\n"""\n${resumeText.slice(0, 1500)}\n"""\n\nSuggest matching job titles.`;

    const result = await mistralJSON(system, user, { temperature: 0.5, maxTokens: 400 });
    return Array.isArray(result.suggestions) ? result.suggestions : [];
}

async function searchJobs(query, resumeText) {
    const system = `You are a career advisor helping search/filter job titles based on a user's partial search query and their resume background.
Respond with ONLY valid JSON: {"suggestions": ["Job Title 1", "Job Title 2", ...]}. Provide up to 8 relevant job titles that relate to the query, informed by the resume.`;

    const user = `Search query: "${query}"\n\nResume excerpt:\n"""\n${resumeText.slice(0, 800)}\n"""\n\nSuggest job titles matching this search, considering both the query and the candidate's background.`;

    const result = await mistralJSON(system, user, { temperature: 0.5, maxTokens: 300 });
    return Array.isArray(result.suggestions) ? result.suggestions : [];
}

module.exports = { analyzeResume, getJobSuggestions, searchJobs };
