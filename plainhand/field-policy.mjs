// One policy for questions a machine must never answer on the candidate's behalf.
export function isSensitiveLabel(label) {
  return /sponsor|authoriz|eligible|gender|race|veteran|disabil|salary|compens|consent|agree|legal|citizen|relocat|privacy|country|ethnic/i.test(String(label || ''));
}
