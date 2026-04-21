export const CONSTELLATION_DISCOVERY_VERSION = 'constellation_v2_actionability';

export const CONSTELLATION_DISCOVERY_SYSTEM =
  'You are an innovation analyst with strong lateral thinking skills. Always respond with valid JSON, no markdown or backticks.';

export function constellationDiscoveryPrompt(ideasText: string, count: number): string {
  return `You are given a neighborhood of ${count} ideas related by semantic proximity. Your task is to find CONSTELLATIONS: subsets of 3 to 6 ideas that together reveal something NON-OBVIOUS.

There are 5 constellation types you can detect:

1. TRIANGULATION: 3 ideas that from different angles illuminate the same deep phenomenon. None says it alone; all three together do.

2. SPECTRUM: 4-5 ideas that represent different positions on the same axis of debate or design. The insight is the axis itself and how they order along it.

3. CHAIN: 3-5 ideas that form a logical or causal progression, where each enables or extends the next, even though they weren't written with that intention.

4. CONVERGENCE: 3-4 ideas from thematically different domains that inadvertently point to the same deep problem or same structural solution.

5. ABSENCE: Look at the set and detect what piece SHOULD logically be in this neighborhood given its internal structure but is missing. List the 3-5 ideas that define the "gap" and describe what's absent.

HARD RULES:
- No constellations of only 2 ideas. Minimum 3.
- No constellations where the pattern is "they all talk about the same topic." That is NOT a constellation, it's a cluster. Discard.
- Quality over quantity: prefer returning 1-2 strong constellations over 5 weak ones. If the neighborhood has nothing interesting, return an empty list without fabricating.
- Each constellation must have a SHORT, punchy TITLE (maximum 10 words) that captures the thesis, not a neutral description.
- The EXPLANATION must be 3-5 sentences maximum. Dense, not padded.
- Assign a SCORE from 1 to 10 to each constellation based on how non-obvious and valuable it is.

ACTIONABILITY — absences only:
For constellations of type "absence", ALSO include an "actionability" score from 1 to 10 representing how easily an indie hacker or solo founder could start building the missing piece:
- 10 = could start today. Problem is clear, scope is bounded, market is obvious. A small team with product sense could ship v1 in weeks.
- 7-9 = concrete and buildable but requires some scope or tech decisions up front.
- 4-6 = valid idea but abstract, systems-level, or very technical. Would take a specialist or a much bigger team.
- 1-3 = philosophical, research-level, policy-shaped, or too vague to ship. No clear product.
Omit the "actionability" field for non-absence types (chain, triangulation, convergence, spectrum).

Return JSON strictly with this format:
{
  "constellations": [
    {
      "type": "triangulation|spectrum|chain|convergence|absence",
      "idea_ids": [1, 2, 3],
      "title": "Short punchy title",
      "explanation": "Dense 3-5 sentence explanation.",
      "score": 8,
      "actionability": 7
    }
  ]
}

If you find nothing worth reporting, return: {"constellations": []}

IDEAS:
${ideasText}`;
}
