// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

interface IFHEReputationNFT {
    function mint(address to, uint256 score) external;
}

contract ForumReputationFHE is SepoliaConfig {
    struct EncryptedUserActivity {
        uint256 userId;
        euint32 encryptedPosts;
        euint32 encryptedReplies;
        euint32 encryptedLikes;
        uint256 timestamp;
    }

    struct ReputationScore {
        euint32 encryptedScore;
        bool mintedNFT;
    }

    uint256 public activityCount;
    mapping(uint256 => EncryptedUserActivity) public userActivities;
    mapping(uint256 => ReputationScore) public reputationScores;

    IFHEReputationNFT public nftContract;

    // Events
    event ActivitySubmitted(uint256 indexed activityId, uint256 timestamp);
    event ReputationCalculated(uint256 indexed userId, euint32 encryptedScore);
    event NFTMinted(uint256 indexed userId, uint256 score);

    constructor(address _nftContract) {
        nftContract = IFHEReputationNFT(_nftContract);
    }

    /// @notice Submit encrypted activity metrics
    function submitActivity(
        uint256 userId,
        euint32 encryptedPosts,
        euint32 encryptedReplies,
        euint32 encryptedLikes
    ) public {
        activityCount += 1;
        uint256 newId = activityCount;

        userActivities[newId] = EncryptedUserActivity({
            userId: userId,
            encryptedPosts: encryptedPosts,
            encryptedReplies: encryptedReplies,
            encryptedLikes: encryptedLikes,
            timestamp: block.timestamp
        });

        emit ActivitySubmitted(newId, block.timestamp);
    }

    /// @notice Compute encrypted reputation score
    function computeReputation(uint256 activityId) public {
        EncryptedUserActivity storage activity = userActivities[activityId];

        euint32 score = FHE.add(activity.encryptedPosts, FHE.mul(activity.encryptedReplies, FHE.asEuint32(2)));
        score = FHE.add(score, FHE.mul(activity.encryptedLikes, FHE.asEuint32(3)));

        reputationScores[activity.userId] = ReputationScore({
            encryptedScore: score,
            mintedNFT: false
        });

        emit ReputationCalculated(activity.userId, score);
    }

    /// @notice Request decryption of reputation score
    function requestReputationDecryption(uint256 userId) public {
        ReputationScore storage rep = reputationScores[userId];
        require(!rep.mintedNFT, "NFT already minted");

        bytes32 ;
        ciphertexts[0] = FHE.toBytes32(rep.encryptedScore);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptReputation.selector);
        _requestToUser[reqId] = userId;
    }

    mapping(uint256 => uint256) private _requestToUser;

    /// @notice Callback for decrypted reputation score
    function decryptReputation(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 userId = _requestToUser[requestId];
        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32 score = abi.decode(cleartexts, (uint32));
        ReputationScore storage rep = reputationScores[userId];

        if (!rep.mintedNFT) {
            nftContract.mint(msg.sender, score);
            rep.mintedNFT = true;
            emit NFTMinted(userId, score);
        }
    }

    /// @notice Aggregate multiple user activities into one encrypted score
    function aggregateActivities(uint256[] memory activityIds, uint256 userId) public {
        euint32 totalScore = FHE.asEuint32(0);

        for (uint256 i = 0; i < activityIds.length; i++) {
            EncryptedUserActivity storage activity = userActivities[activityIds[i]];
            if (activity.userId == userId) {
                euint32 score = FHE.add(activity.encryptedPosts, FHE.mul(activity.encryptedReplies, FHE.asEuint32(2)));
                score = FHE.add(score, FHE.mul(activity.encryptedLikes, FHE.asEuint32(3)));
                totalScore = FHE.add(totalScore, score);
            }
        }

        reputationScores[userId].encryptedScore = totalScore;
    }

    /// @notice Get encrypted score
    function getEncryptedScore(uint256 userId) public view returns (euint32) {
        return reputationScores[userId].encryptedScore;
    }
}
