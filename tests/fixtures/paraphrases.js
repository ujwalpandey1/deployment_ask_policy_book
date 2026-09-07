// Hand-authored from the released source documents, not held-out questions.
// These are regression expectations, never input to retrieval or generation.
const harbour = 'HARBOUR_internal_servicing_policy';
const lei = 'RBI_Master_Dir_master_direction_-_reserve_bank_of_india_unique_identif_084';
const bank = 'RBI_Reserve_Ba_reserve_bank_of_india_small_finance_banks_prudential_no_099';
export const families = [
  { id: 'waiver', role: 'ops', document: harbour, patterns: ['2,?500'], questions: [
    'What is the maximum single fee that a Harbour agent may waive?',
    'At Harbour, what is the most an automated agent can forgive from one loan charge?',
    'How big a charge can I wipe off a Harbour loan without getting a human to approve the amount?',
  ] },
  { id: 'payment', role: 'ops', document: harbour, patterns: ['60|sixty'], questions: [
    'How many days ahead may a new one-off payment be scheduled at Harbour?',
    'At Harbour, how far into the future can I book a fresh repayment?',
    'Could Harbour set up a new debit three months from now, or is that too far away?',
  ] },
  { id: 'identity', role: 'ops', document: harbour, patterns: ['four|4', 'mobile|phone'], questions: [
    'How is customer identity verified on the current contact at Harbour?',
    'At Harbour, which details should I ask for to prove I am speaking to the borrower?',
    'What does a caller need to confirm before Harbour lets me make changes involving their money?',
  ] },
  { id: 'hardship-age', role: 'ops', document: harbour, patterns: ['six|6', 'month'], questions: [
    'What is the minimum loan age for a hardship plan at Harbour?',
    'How long must a Harbour loan have existed before the borrower can get temporary repayment relief?',
    'A Harbour borrower wants a financial difficulty arrangement. How seasoned must their loan be?',
  ] },
  { id: 'dispute-resolution', role: 'ops', document: harbour, patterns: ['30|thirty', 'day'], questions: [
    'What is the resolution deadline for a payment dispute at Harbour?',
    'Once a borrower challenges a repayment, how long have we got to sort it out at Harbour?',
    'How quickly does Harbour have to settle a disagreement about a payment after it is raised?',
  ] },
  { id: 'statement-address', role: 'ops', document: harbour, patterns: ['not|only|cannot|must|no,', 'record|file|register|updat'], questions: [
    'Where may Harbour send a loan statement?',
    'Can Harbour mail my loan statement somewhere other than the address in my customer details?',
    'I want Harbour to dispatch my account statement to a different destination. Is that allowed before updating my contact details?',
  ] },
  { id: 'lei-required', role: 'public', document: lei, patterns: ['not|cannot|no,|ineligible'], questions: [
    'Can an entity without an LEI transact in financial markets regulated by RBI?',
    'Is a firm missing its legal entity identifier allowed to trade in markets overseen by the Reserve Bank?',
    'Does the Reserve Bank let a company deal in its regulated markets before getting its LEI code?',
  ] },
  { id: 'fx-threshold', role: 'public', document: lei, patterns: ['million|1,?000,?000|10,00,000'], questions: [
    'What transaction amount triggers the LEI requirement for non-derivative foreign exchange clients?',
    'For ordinary currency trades that are not derivatives, at what deal size does RBI require a legal entity identifier?',
    'How large must a plain foreign-exchange transaction be before the customer needs an LEI under the Reserve Bank rules?',
  ] },
  { id: 'dividend-report', role: 'public', document: bank, patterns: ['fortnight|14|fourteen|two weeks|2 weeks'], questions: [
    'What is the reporting deadline after a small finance bank declares a dividend?',
    'After a small finance bank decides to pay its shareholders a dividend, when must it notify RBI supervisors?',
    'How much time does a small finance lender have to tell the Reserve Bank about its dividend declaration?',
  ] },
  { id: 'uti-start', role: 'public', document: lei, patterns: ['2027', 'January|Jan|01'], questions: [
    'When do the RBI Unique Transaction Identifier directions take effect?',
    'From what date must the RBI UTI rules for over-the-counter derivatives be followed?',
    'When does Section B on unique trade identifiers start applying under the Reserve Bank directions?',
  ] },
];

export const paraphraseCases = [
  ...families.flatMap(f => f.questions.map((question, i) => ({ id: `${f.id}-${i}`, family: f.id, variant: i, question, role: f.role,
    as_of: '2026-09-07', expected_status: 'answered', document: f.document, patterns: f.patterns }))),
  ...families.filter(f => f.role === 'ops').map(f => ({ id: `blocked-${f.id}`, family: 'access', question: f.questions[2], role: 'public',
    as_of: '2026-09-07', expected_status: 'not_permitted' })),
  ...[
    'How many days of annual leave do Harbour employees receive?',
    'What is the minimum CCTV retention period required for NBFC branch offices?',
    'Which medication should Harbour employees take for a headache?',
    'What is the capital of France?',
  ].map((question, i) => ({ id: `absent-${i}`, family: 'absent', question, role: 'legal', as_of: '2026-09-07', expected_status: 'not_in_corpus' })),
  { id: 'not-yet-effective', family: 'date', question: 'What was the maximum single fee that a Harbour agent could waive?', role: 'ops',
    as_of: '2025-12-31', expected_status: 'not_in_corpus' },
];
