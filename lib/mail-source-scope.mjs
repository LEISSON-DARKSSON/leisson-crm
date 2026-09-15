// Current owner-approved source mailbox for CRM model work and mail selection.
// Changing this scope requires a new explicit owner instruction.
export const CRM_MAIL_SOURCE_ACCOUNT = 'gert';
export const CRM_MAIL_SOURCE_ADDRESS = 'gert@leisson.eu';
export const MAIL_SOURCE_SCOPE_REASON = 'CRM-i töö kasutab ainult gert@leisson.eu postkasti';
export function assertMailSource(message) {
  if(!message || message.account!==CRM_MAIL_SOURCE_ACCOUNT)throw new Error(MAIL_SOURCE_SCOPE_REASON);
  return message;
}
