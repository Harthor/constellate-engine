import { getDb, loadIdeas, cacheEmbeddings } from '../src/db/database.js';
import { createEmbedder } from '../src/embeddings/embedder.js';

async function main() {
  const embedderName = process.argv[2] || 'tfidf';
  const db = getDb();
  const ideas = loadIdeas(db);

  if (ideas.length === 0) {
    console.error('No ideas in database. Run `constellate ingest` first.');
    process.exit(1);
  }

  console.log(`Generating embeddings for ${ideas.length} ideas with ${embedderName}...`);
  const embedder = await createEmbedder(embedderName);

  const docs = ideas.map((i) => {
    const content = (i.description || '').slice(0, 500);
    return `${i.title} ${i.category || ''} ${content}`;
  });

  const { vectors, dimensions } = await embedder.embed(docs);
  console.log(`Computed ${vectors.length} vectors (${dimensions} dimensions)`);

  const entries = ideas.map((idea, idx) => ({
    id: idea.id,
    vector: vectors[idx],
  }));
  cacheEmbeddings(entries, embedder.model, db);

  console.log(`Cached ${entries.length} embeddings.`);
  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
