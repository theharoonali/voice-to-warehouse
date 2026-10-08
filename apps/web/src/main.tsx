import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { VoiceTranscriber } from './components/VoiceTranscriber';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('The root element is missing.');

createRoot(root).render(
  <StrictMode>
    <VoiceTranscriber />
  </StrictMode>,
);
