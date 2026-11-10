// Sample replies illustrate the format. The live agent will use an owner-approved profile.
export const questions = [
  {
    title: 'Life story',
    prompt: 'What should we know about your life story in a few sentences?',
    match: /life story|tell me about yourself|background|introduce yourself|who are you/i,
    answer: 'I like building things that make AI useful in everyday work. DayPilot is one example: it explores how an agent can coordinate work across tools. WoiseX100 asks a different question: can an interview feel like a conversation you can start with one click?',
  },
  {
    title: 'Superpower',
    prompt: 'What’s your #1 superpower?',
    match: /super\s*power|\bstrengths?\b|best at|what are you good at/i,
    answer: 'Taking a vague idea and turning it into something people can try. I like to get a small version in front of someone early, watch where they get stuck, and use that to decide what to build next.',
  },
  {
    title: 'Areas to grow',
    prompt: 'What are the top 3 areas you’d like to grow in?',
    match: /\bgrow(?:th)?\b|improv|learn more|weakness|development areas/i,
    answer: 'Three areas: designing better evaluations for agents, getting faster at deciding what to cut, and making technical trade-offs easier to explain to the people who’ll use the product.',
  },
  {
    title: 'Misconceptions',
    prompt: 'What misconception do your coworkers have about you?',
    match: /misconception|misunderst|wrong about|coworker|co-worker/i,
    answer: 'When I’m quiet in a discussion, it can look like I’m already decided. Usually I’m still thinking. I try to say what I’m weighing out loud so people can challenge it earlier.',
  },
  {
    title: 'Pushing limits',
    prompt: 'How do you push your boundaries and limits?',
    match: /boundar|\blimits?\b|comfort zone|challenge yourself|push yourself/i,
    answer: 'I pick a project with one part I don’t know how to do yet and give myself a short deadline to ship a working version. Then I put it in front of somebody and ask them to try it without my help. That’s where I learn the most.',
  },
];

export function previewReply(question) {
  const sample = questions.find(({ match }) => match.test(question));
  return sample?.answer ?? 'This preview has five sample answers. Try asking about my life story, superpower, growth areas, a coworker misconception, or how I push my limits. Live follow-up questions will be available once the interview profile is connected.';
}
