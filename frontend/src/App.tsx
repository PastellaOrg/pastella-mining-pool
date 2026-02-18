import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/shared';
import Dashboard from './components/pages/Dashboard';
import Start from './components/pages/Start';
import Miner from './components/pages/Miner';
import Blocks from './components/pages/Blocks';
import Payments from './components/pages/Payments';
import TopMiners from './components/pages/TopMiners';

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/start" element={<Start />} />
          <Route path="/miner/:address" element={<Miner />} />
          <Route path="/blocks" element={<Blocks />} />
          <Route path="/payments" element={<Payments />} />
          <Route path="/top" element={<TopMiners />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
};

export default App;
