import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/shared';
import Dashboard from './components/pages/Dashboard';
import Start from './components/pages/Start';
import Miner from './components/pages/Miner';
import Blocks from './components/pages/Blocks';
import Payments from './components/pages/Payments';
import TopMiners from './components/pages/TopMiners';
import Admin from './components/pages/Admin';

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        {/* Admin route without Layout */}
        <Route path="/admin" element={<Admin />} />
        {/* Main app wrapper with Layout */}
        <Route path="/" element={<Layout><Dashboard /></Layout>} />
        <Route path="/start" element={<Layout><Start /></Layout>} />
        <Route path="/miner/:address" element={<Layout><Miner /></Layout>} />
        <Route path="/blocks" element={<Layout><Blocks /></Layout>} />
        <Route path="/payments" element={<Layout><Payments /></Layout>} />
        <Route path="/top" element={<Layout><TopMiners /></Layout>} />
        {/* Catch all - redirect to dashboard */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
