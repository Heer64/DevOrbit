import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import MotionEffects from './components/MotionEffects.jsx';
import './styles.css';
import './solar-ember.css'; // Solar Ember redesign layer (colours, glass, motion, intro page)
import './ember-app.css'; // Solar Ember app layout layer (mirrors the demo artifact)

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <App />
          <MotionEffects />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
