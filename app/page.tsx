"use client";
import { useState } from 'react';
import { usePrivy } from '@privy-io/react-auth'; // Privy hook'u ekle
import ChoppingGame from './components/ChoppingGame';
import AuthComponent from './components/AuthComponent';
import ScoreDebugger from './components/ScoreDebugger';
import ProfileCard from './profile-card/ProfileCard';

export default function Home() {
  const [playerAddress, setPlayerAddress] = useState<string>("");
  const { logout } = usePrivy(); // Privy logout fonksiyonu

  const handleLogout = async () => {
    await logout();
    setPlayerAddress("");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#3a2176] to-[#1a093e] flex flex-col items-center justify-center">
      {/* Başlıklar iki sütunun üstünde */}
      <h1 className="text-6xl font-extrabold text-purple-300 mb-2 text-center">ChopUp<span className="text-yellow-400">Nad</span></h1>
      <h1 className="text-3xl font-extrabold text-purple-700 mb-2 text-center">Chop or Be Chopped</h1>
      {!playerAddress ? (
        <div className="rounded-2xl border border-purple-700 shadow-xl p-8 w-full max-w-4xl bg-[#2a155e] flex flex-row items-center gap-8">
          {/* Sol sütun: Sabit genişlik */}
          <div className="flex flex-col items-center w-[400px] gap-4">
            <img src="/sef1.png" alt="Pepe Football" className="w-92 h-92 mx-auto mb-2" />
            <p className="text-center text-purple-100 mb-4">
              Sign in with your <span className="font-bold text-purple-300">Monad Games ID</span> to start your culinary journey.
            </p>
            <AuthComponent onAddressChange={setPlayerAddress} />
            <div className="text-xl text-purple-400 mt-4 text-center">Powered by Monad Games ID</div>
          </div>
          {/* Sağ sütun: ProfileCard, kalan alan */}
          <div className="flex flex-col items-center flex-1">
            <div className="bg-[#1a093e] rounded-xl p-4 w-full flex justify-center">
              <ProfileCard
                name="0xGbyte"
                title="Solution Architect, Builder, devnads"
                handle="0xGbyte"
                status="Online"
                contactText="Contact Me"
                avatarUrl="avatar.png"
                iconUrl="https://image.typedream.com/cdn-cgi/image/width=256,format=auto,fit=scale-down,quality=100/https://api.typedream.com/v0/document/public/1e17facc-56e9-4158-9522-8cfee85931a9/2tS1LeqCV4dxzhWdmeCQURYlmow_monad_logo.png"
                showUserInfo={true}
                enableTilt={true}
                showBehindGradient={true}
                enableMobileTilt={false}
                onContactClick={() => window.open("https://x.com/0xGbyte", "_blank")}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-8 w-full">
          <button
            onClick={handleLogout}
            className="self-end bg-purple-700 hover:bg-purple-800 text-white font-bold py-2 px-4 rounded mb-4 transition"
            style={{ position: "absolute", top: 24, right: 24, zIndex: 50 }}
          >
            Logout
          </button>
          <ChoppingGame playerAddress={playerAddress} />
          <ScoreDebugger playerAddress={playerAddress} />
        </div>
      )}
    </div>
  );
}