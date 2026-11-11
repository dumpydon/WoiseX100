// Prompt metadata is public. Personal answers come from the server-side profile.
export const questions = [
  {
    title: 'Life story',
    prompt: 'What should we know about your life story in a few sentences?',
    match: /life story|tell me about yourself|background|introduce yourself|who are you/i,
  },
  {
    title: 'Superpower',
    prompt: 'What’s your #1 superpower?',
    match: /super\s*power|\bstrengths?\b|best at|what are you good at/i,
  },
  {
    title: 'Areas to grow',
    prompt: 'What are the top 3 areas you’d like to grow in?',
    match: /\bgrow(?:th)?\b|improv|learn more|weakness|development areas/i,
  },
  {
    title: 'Misconceptions',
    prompt: 'What misconception do your coworkers have about you?',
    match: /misconception|misunderst|wrong about|coworker|co-worker/i,
  },
  {
    title: 'Pushing limits',
    prompt: 'How do you push your boundaries and limits?',
    match: /boundar|\blimits?\b|comfort zone|challenge yourself|push yourself/i,
  },
];

export function previewReply() {
  return 'Live AI replies are unavailable in this interface preview. The connected version answers from Piyush’s interview profile. You can still try typing, dictation, and audio playback here.';
}
