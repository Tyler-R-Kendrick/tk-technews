export function assertDailyPayloadIsPublishable(payload, options = {}) {
  const {
    allowEmpty = false,
    date = payload?.date ?? 'unknown date'
  } = options;

  if (allowEmpty) return;

  const sourceItemCount = Number(payload?.sourceItemCount ?? 0);
  const articleCount = Array.isArray(payload?.articleStubs) ? payload.articleStubs.length : 0;

  if (sourceItemCount <= 0) {
    throw new Error(
      `Refusing to publish empty daily payload for ${date}: sourceItemCount is 0. ` +
      'Source ingestion or precompile likely failed upstream. Re-run with --allow-empty to override.'
    );
  }

  if (articleCount <= 0) {
    throw new Error(
      `Refusing to publish empty daily payload for ${date}: articleStubs is empty. ` +
      'Generated articles did not pass publish checks. Re-run with --allow-empty to override.'
    );
  }
}
