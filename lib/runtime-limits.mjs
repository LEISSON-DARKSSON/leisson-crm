// Non-secret controls. Deliberately independent of mailbox credentials and .env.
const boundedInt=(value,fallback,min,max)=>{ const n=Number(value); return value!==undefined&&String(value).trim()!==''&&Number.isInteger(n)&&n>=min&&n<=max?n:fallback; };
export function runtimeLimits(env=process.env) {
  return {
    maxDrafts:boundedInt(env.AGENT_MAX_DRAFTS,3,0,20),
    maxAgeDays:boundedInt(env.AGENT_MAX_AGE_DAYS,21,1,90),
    triageBatch:boundedInt(env.AGENT_TRIAGE_BATCH,10,1,25),
    maxRunsDaily:boundedInt(env.AGENT_MAX_RUNS_DAILY,24,0,100),
  };
}
