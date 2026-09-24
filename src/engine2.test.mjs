import * as E from './engine.js';
const docs = [
  'To reset your password, go to Settings > Security and click Reset Password.',
  'Our office is located in Wilmington, Delaware and open 9-5 EST.',
  'Password requirements: minimum 12 characters, one number, one symbol.',
  'The annual plan costs $199 and includes priority support.',
  'If you forgot your password, use the "Forgot password" link on the login page.',
  'Our mobile app is available on iOS and Android.',
  'Two-factor authentication can be enabled under Security settings.',
  'We accept Visa, Mastercard, and American Express.',
];
console.log('compressContext:');
const c = E.compressContext('how do I reset my password', docs, { maxDocs: 3, minRelevance: 0.5 });
console.log('  kept', c.keptDocs, '/', c.totalDocs, '| before', c.tokensBefore, 'after', c.tokensAfter, 'saved', c.tokensSaved, `(${c.percentSaved}%)`);
console.log('  contextBlock:\n', c.context.split('\n').map(l=>'   '+l).join('\n'));
console.log('\ncompareTexts (similar):', E.compareTexts('reset my password','how to reset password'));
console.log('compareTexts (different):', E.compareTexts('reset my password','the weather is sunny today'));
console.log('\ngenerateEmbeddings:', (()=>{const e=E.generateEmbeddings(['hello world','foo bar']); return {dim:e.dimension,count:e.count};})());
console.log('\nestimateSavings:', E.estimateSavings(docs, [docs[0],docs[2],docs[4]], 3.0));
