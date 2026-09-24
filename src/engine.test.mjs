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
  'Password reset links expire after 30 minutes for security.',
  'The dashboard shows your usage metrics in real time.',
];

console.log('--- countTokens ---');
console.log('tokens in doc0:', E.countTokens(docs[0]));

console.log('\n--- rerankDocuments ---');
console.log(E.rerankDocuments('reset a forgotten password', docs, { topK: 3 }));

console.log('\n--- filterContext (the token-saver) ---');
const f = E.filterContext('reset a forgotten password', docs, { maxDocs: 3, minRelevance: 0.5 });
console.log('kept:', f.keptDocs, '/', f.totalDocs, '| allTokens:', f.allTokens, '| keptTokens:', f.keptTokens, '| savedTokens:', f.savedTokens, '| savedPct:', f.savedPct + '%');

console.log('\n--- classifyText (needs examples) ---');
const examples = [
  { text: 'I was charged twice this month', label: 'billing' },
  { text: 'my invoice is wrong', label: 'billing' },
  { text: 'the app keeps crashing', label: 'technical_support' },
  { text: 'I get an error when uploading', label: 'technical_support' },
  { text: 'how do I reset my password', label: 'account' },
  { text: 'change my email address', label: 'account' },
];
console.log(E.classifyText('the app crashes on upload', ['billing','technical_support','account'], examples));

console.log('\n--- classifyText with NO examples (honest refusal) ---');
console.log(E.classifyText('anything', ['a','b'], []));

console.log('\n--- detectLanguage ---');
console.log(E.detectLanguage('bonjour comment allez vous'));
console.log(E.detectLanguage('the quick brown fox jumps'));

console.log('\n--- summarizeFromDocuments ---');
console.log(E.summarizeFromDocuments('how do I reset my password', docs, { maxDocs: 3 }));

console.log('\n--- semanticSearch ---');
console.log(E.semanticSearch('payment methods accepted', docs, { topK: 2 }));

console.log('\nALL ENGINE METHODS RAN.');
