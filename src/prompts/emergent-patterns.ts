export const EMERGENT_PATTERNS_VERSION = 'patterns_v1';

export const EMERGENT_PATTERNS_SYSTEM =
  'You are an innovation analyst with strong lateral thinking skills. Always respond with valid JSON, no markdown or backticks.';

export function emergentPatternsPrompt(ideasText: string): string {
  return `You have this group of technology ideas/projects that were clustered by similarity:

${ideasText}

TASK: Look at the ideas as a SET and detect 1-3 underlying patterns or themes that are probably not obvious. Don't look for surface-level categories (like "many are about AI") — look for undercurrents: shared assumptions, cultural movements, implicit paradigm shifts, revealing absences.

Return ONLY JSON:
{
  "patterns": [
    {
      "name": "Short pattern name",
      "idea_ids": [ids of the ideas that compose it],
      "explanation": "Description of the pattern and why it's significant"
    }
  ]
}`;
}
