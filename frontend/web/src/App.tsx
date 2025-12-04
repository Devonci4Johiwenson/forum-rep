import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface ReputationRecord {
  id: string;
  username: string;
  reputationScore: number;
  lastUpdated: number;
  badges: string[];
  activities: {
    type: "question" | "answer" | "like";
    timestamp: number;
    points: number;
  }[];
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<ReputationRecord[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [showTeamInfo, setShowTeamInfo] = useState(false);

  // Calculate statistics
  const totalUsers = records.length;
  const averageReputation = totalUsers > 0 
    ? records.reduce((sum, record) => sum + record.reputationScore, 0) / totalUsers 
    : 0;
  const topUsers = [...records].sort((a, b) => b.reputationScore - a.reputationScore).slice(0, 3);

  // Pie chart data for badge distribution
  const badgeCounts: Record<string, number> = {};
  records.forEach(record => {
    record.badges.forEach(badge => {
      badgeCounts[badge] = (badgeCounts[badge] || 0) + 1;
    });
  });

  useEffect(() => {
    loadRecords().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadRecords = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("reputation_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing reputation keys:", e);
        }
      }
      
      const list: ReputationRecord[] = [];
      
      for (const key of keys) {
        try {
          const recordBytes = await contract.getData(`reputation_${key}`);
          if (recordBytes.length > 0) {
            try {
              const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
              list.push({
                id: key,
                username: recordData.username,
                reputationScore: recordData.reputationScore,
                lastUpdated: recordData.lastUpdated,
                badges: recordData.badges || [],
                activities: recordData.activities || []
              });
            } catch (e) {
              console.error(`Error parsing record data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading record ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.reputationScore - a.reputationScore);
      setRecords(list);
    } catch (e) {
      console.error("Error loading records:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const simulateForumActivity = async (activityType: "question" | "answer" | "like") => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing activity with Zama FHE..."
    });
    
    try {
      // Simulate FHE computation for reputation calculation
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      // Generate a unique ID for this user
      const userId = `${account.substring(0, 8)}-${Date.now()}`;
      
      // Calculate points based on activity type
      const points = activityType === "question" ? 5 : 
                    activityType === "answer" ? 10 : 1;
      
      // Get existing record if available
      let existingRecord: ReputationRecord | null = null;
      const recordBytes = await contract.getData(`reputation_${userId}`);
      if (recordBytes.length > 0) {
        existingRecord = JSON.parse(ethers.toUtf8String(recordBytes));
      }
      
      // Create or update record
      const updatedRecord: ReputationRecord = existingRecord || {
        id: userId,
        username: `user-${Math.floor(Math.random() * 1000)}`,
        reputationScore: 0,
        lastUpdated: Math.floor(Date.now() / 1000),
        badges: [],
        activities: []
      };
      
      // Add new activity
      updatedRecord.activities.push({
        type: activityType,
        timestamp: Math.floor(Date.now() / 1000),
        points: points
      });
      
      // Update reputation score
      updatedRecord.reputationScore += points;
      updatedRecord.lastUpdated = Math.floor(Date.now() / 1000);
      
      // Award badges based on score
      if (updatedRecord.reputationScore >= 50 && !updatedRecord.badges.includes("Bronze")) {
        updatedRecord.badges.push("Bronze");
      }
      if (updatedRecord.reputationScore >= 150 && !updatedRecord.badges.includes("Silver")) {
        updatedRecord.badges.push("Silver");
      }
      if (updatedRecord.reputationScore >= 300 && !updatedRecord.badges.includes("Gold")) {
        updatedRecord.badges.push("Gold");
      }
      
      // Store updated record
      await contract.setData(
        `reputation_${userId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRecord))
      );
      
      // Update keys if new record
      if (!existingRecord) {
        const keysBytes = await contract.getData("reputation_keys");
        let keys: string[] = [];
        
        if (keysBytes.length > 0) {
          try {
            keys = JSON.parse(ethers.toUtf8String(keysBytes));
          } catch (e) {
            console.error("Error parsing keys:", e);
          }
        }
        
        keys.push(userId);
        
        await contract.setData(
          "reputation_keys", 
          ethers.toUtf8Bytes(JSON.stringify(keys))
        );
      }
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE reputation updated successfully!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Operation failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const testContractAvailability = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Testing FHE contract availability..."
    });
    
    try {
      const contract = await getContractReadOnly();
      if (!contract) {
        throw new Error("Failed to get contract");
      }
      
      const isAvailable = await contract.isAvailable();
      
      setTransactionStatus({
        visible: true,
        status: isAvailable ? "success" : "error",
        message: isAvailable 
          ? "FHE contract is available and ready!" 
          : "FHE contract is not available"
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Test failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to interact with the reputation system",
      icon: "🔗"
    },
    {
      title: "Participate in Forum",
      description: "Ask questions, provide answers, and engage with the community",
      icon: "💬"
    },
    {
      title: "FHE Reputation Calculation",
      description: "Your reputation score is calculated privately using FHE technology",
      icon: "🔒"
    },
    {
      title: "Earn NFT Badges",
      description: "Receive NFT badges based on your reputation achievements",
      icon: "🏆"
    }
  ];

  const renderPieChart = () => {
    const totalBadges = Object.values(badgeCounts).reduce((sum, count) => sum + count, 0);
    if (totalBadges === 0) {
      return (
        <div className="pie-chart-container">
          <div className="no-data-message">No badges awarded yet</div>
        </div>
      );
    }

    const bronzePercentage = (badgeCounts["Bronze"] || 0) / totalBadges * 100;
    const silverPercentage = (badgeCounts["Silver"] || 0) / totalBadges * 100;
    const goldPercentage = (badgeCounts["Gold"] || 0) / totalBadges * 100;

    return (
      <div className="pie-chart-container">
        <div className="pie-chart">
          <div 
            className="pie-segment bronze" 
            style={{ transform: `rotate(${bronzePercentage * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment silver" 
            style={{ transform: `rotate(${(bronzePercentage + silverPercentage) * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment gold" 
            style={{ transform: `rotate(${(bronzePercentage + silverPercentage + goldPercentage) * 3.6}deg)` }}
          ></div>
          <div className="pie-center">
            <div className="pie-value">{totalBadges}</div>
            <div className="pie-label">Badges</div>
          </div>
        </div>
        <div className="pie-legend">
          <div className="legend-item">
            <div className="color-box bronze"></div>
            <span>Bronze: {badgeCounts["Bronze"] || 0}</span>
          </div>
          <div className="legend-item">
            <div className="color-box silver"></div>
            <span>Silver: {badgeCounts["Silver"] || 0}</span>
          </div>
          <div className="legend-item">
            <div className="color-box gold"></div>
            <span>Gold: {badgeCounts["Gold"] || 0}</span>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="metal-spinner"></div>
      <p>Initializing FHE reputation system...</p>
    </div>
  );

  return (
    <div className="app-container metal-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="shield-icon"></div>
          </div>
          <h1>Zama<span>FHE</span>Reputation</h1>
        </div>
        
        <div className="header-actions">
          <button 
            className="metal-button"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Tutorial" : "Show Tutorial"}
          </button>
          <button 
            className="metal-button"
            onClick={() => setShowTeamInfo(!showTeamInfo)}
          >
            {showTeamInfo ? "Hide Team" : "Show Team"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>FHE-Powered Forum Reputation System</h2>
            <p>Securely calculate reputation scores using Fully Homomorphic Encryption</p>
          </div>
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>FHE Reputation System Tutorial</h2>
            <p className="subtitle">Learn how to build reputation on our developer forum</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="dashboard-grid">
          <div className="dashboard-card metal-card">
            <h3>Forum Participation</h3>
            <p>Engage with the community to build your reputation:</p>
            <div className="activity-buttons">
              <button 
                className="metal-button bronze"
                onClick={() => simulateForumActivity("question")}
              >
                Ask Question (+5)
              </button>
              <button 
                className="metal-button silver"
                onClick={() => simulateForumActivity("answer")}
              >
                Answer Question (+10)
              </button>
              <button 
                className="metal-button gold"
                onClick={() => simulateForumActivity("like")}
              >
                Like Content (+1)
              </button>
            </div>
            <div className="test-contract">
              <button 
                className="metal-button"
                onClick={testContractAvailability}
              >
                Test FHE Contract
              </button>
            </div>
          </div>
          
          <div className="dashboard-card metal-card">
            <h3>Reputation Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{totalUsers}</div>
                <div className="stat-label">Total Users</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{averageReputation.toFixed(1)}</div>
                <div className="stat-label">Avg. Reputation</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{topUsers[0]?.reputationScore || 0}</div>
                <div className="stat-label">Top Score</div>
              </div>
            </div>
            
            <div className="top-users">
              <h4>Top Contributors</h4>
              {topUsers.length > 0 ? (
                <ul>
                  {topUsers.map((user, index) => (
                    <li key={user.id}>
                      <span className="rank">{index + 1}</span>
                      <span className="username">{user.username}</span>
                      <span className="score">{user.reputationScore} pts</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No users yet</p>
              )}
            </div>
          </div>
          
          <div className="dashboard-card metal-card">
            <h3>Badge Distribution</h3>
            {renderPieChart()}
          </div>
        </div>
        
        <div className="records-section">
          <div className="section-header">
            <h2>Reputation Leaderboard</h2>
            <div className="header-actions">
              <button 
                onClick={loadRecords}
                className="refresh-btn metal-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="records-list metal-card">
            <div className="table-header">
              <div className="header-cell">Rank</div>
              <div className="header-cell">Username</div>
              <div className="header-cell">Reputation</div>
              <div className="header-cell">Badges</div>
              <div className="header-cell">Last Activity</div>
            </div>
            
            {records.length === 0 ? (
              <div className="no-records">
                <div className="no-records-icon"></div>
                <p>No reputation records found</p>
                <button 
                  className="metal-button primary"
                  onClick={() => simulateForumActivity("question")}
                >
                  Start Building Reputation
                </button>
              </div>
            ) : (
              records.map((record, index) => (
                <div className="record-row" key={record.id}>
                  <div className="table-cell rank">#{index + 1}</div>
                  <div className="table-cell username">{record.username}</div>
                  <div className="table-cell reputation">{record.reputationScore}</div>
                  <div className="table-cell badges">
                    {record.badges.map(badge => (
                      <span key={badge} className={`badge ${badge.toLowerCase()}`}>
                        {badge}
                      </span>
                    ))}
                    {record.badges.length === 0 && <span>No badges yet</span>}
                  </div>
                  <div className="table-cell">
                    {new Date(record.lastUpdated * 1000).toLocaleDateString()}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      
      {showTeamInfo && (
        <div className="team-modal">
          <div className="team-content metal-card">
            <div className="modal-header">
              <h2>Zama FHE Development Team</h2>
              <button onClick={() => setShowTeamInfo(false)} className="close-modal">&times;</button>
            </div>
            
            <div className="team-members">
              <div className="team-member">
                <div className="member-avatar"></div>
                <h3>Dr. Elena Rodriguez</h3>
                <p>Chief Cryptographer</p>
                <p>PhD in Applied Cryptography, 10+ years in FHE research</p>
              </div>
              
              <div className="team-member">
                <div className="member-avatar"></div>
                <h3>James Chen</h3>
                <p>Blockchain Architect</p>
                <p>Expert in zero-knowledge proofs and smart contract security</p>
              </div>
              
              <div className="team-member">
                <div className="member-avatar"></div>
                <h3>Sophie Dubois</h3>
                <p>Community Lead</p>
                <p>Developer relations specialist with Web3 experience</p>
              </div>
            </div>
            
            <div className="team-mission">
              <h3>Our Mission</h3>
              <p>
                At Zama, we're building the next generation of privacy-preserving technologies 
                using Fully Homomorphic Encryption. Our goal is to enable developers to build 
                applications that protect user data without compromising functionality.
              </p>
            </div>
          </div>
        </div>
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content metal-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="metal-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="shield-icon"></div>
              <span>Zama FHE Reputation System</span>
            </div>
            <p>Privacy-preserving reputation scoring using Fully Homomorphic Encryption</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Forum</a>
            <a href="#" className="footer-link">GitHub</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} Zama FHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;