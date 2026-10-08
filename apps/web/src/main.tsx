import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GreetingCard } from './components/GreetingCard';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('The root element is missing.');

createRoot(root).render(
  <StrictMode>
    <GreetingCard />
  </StrictMode>,
);
