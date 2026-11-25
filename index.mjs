import {createAssistantMessageEventStream} from '@mariozechner/pi-ai';
import {streamSimpleOpenAICompletions} from '@mariozechner/pi-ai/openai-completions';
import {createIntegration} from './src/provider.mjs';

export default function (pi) {
  // Discover only through the active session's registry. Opening a default auth
  // store here could select the wrong account in an SDK-managed Pi session.
  createIntegration(pi, {createStream: createAssistantMessageEventStream, streamCompletions: streamSimpleOpenAICompletions});
}
