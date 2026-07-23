import { checkUpsTracking } from '../src/lib/services/ups';

async function main() {
  const tn = process.argv[2] || '1ZXJ19770202220518';
  console.log('Testing UPS tracking for:', tn);
  const results = await checkUpsTracking([tn]);
  console.log('RESULT:', JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
