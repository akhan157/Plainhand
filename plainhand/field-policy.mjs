// One policy for questions a machine must never answer on the candidate's behalf.
export function isSensitiveLabel(label) {
  // Hourly, trade and healthcare applications ask for age, conviction history and
  // pay rate in their own words; those are the candidate's to answer too.
  return /sponsor|authoriz|eligible|gender|race|veteran|disabil|salary|compens|consent|agree|legal|citizen|relocat|privacy|country|ethnic|\bage\b|years of age|date of birth|birth ?date|\bdob\b|convict|felony|criminal|background check|desired pay|pay rate|pay expectation|\bwages?\b|hourly rate/i.test(String(label || ''));
}
