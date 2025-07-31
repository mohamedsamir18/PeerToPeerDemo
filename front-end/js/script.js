const yourId = Math.floor(Math.random() * 1e9).toString();
let remoteId = null;
let peerConnection = null;

const yourVideo = document.getElementById("yourVideo");
const friendsVideo = document.getElementById("friendsVideo");
const peerIdSpan = document.getElementById("myPeerId");
const logBox = document.getElementById("logOutput");

peerIdSpan.textContent = yourId;

function log(msg) {
  console.log(msg);
  const div = document.createElement("div");
  div.textContent = msg;
  logBox.appendChild(div);
  logBox.scrollTop = logBox.scrollHeight;
}

// WebSocket setup
const socket = new WebSocket("ws://localhost:5204/ws");

socket.onopen = () => {
  log("✅ Connected to signaling server");
  sendSignal("register", null, null);
};

socket.onerror = (e) => log("❌ WebSocket error");
socket.onclose = () => log("🔌 WebSocket closed");

socket.onmessage = async (event) => {
  const message = JSON.parse(event.data);
  log(`📩 Received ${message.type} from ${message.senderId}`);

  switch (message.type) {
    case 'offer':
      remoteId = message.senderId;  // Save remoteId here
      peerConnection = createPeerConnection(remoteId);

      await peerConnection.setRemoteDescription(new RTCSessionDescription(message.data));

      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      sendSignal('answer', remoteId, peerConnection.localDescription);
      log(`📤 Sent answer to ${remoteId}`);
      break;

    case 'answer':
      if (!peerConnection) {
        log("❌ No peer connection exists for the answer");
        return;
      }
      await peerConnection.setRemoteDescription(new RTCSessionDescription(message.data));
      log(`✅ Remote description set from answer`);
      break;

    case 'ice':
      if (message.data) {
        if (!peerConnection) {
          log("❌ No peer connection exists to add ICE candidate");
          return;
        }
        try {
          await peerConnection.addIceCandidate(new RTCIceCandidate(message.data));
          log(`✅ Added ICE candidate`);
        } catch (e) {
          console.error('❌ Error adding received ice candidate', e);
        }
      }
      break;

    // Add any other case logic like 'register', etc.
  }
};

// Send signaling message
function sendSignal(type, targetUserId, data) {
  const message = {
    type,
    senderId: yourId,
    targetUserId,
    data
  };
  socket.send(JSON.stringify(message));
  log(`📤 Sent ${type} to ${targetUserId || "server"}`);
}

// Create a new peer connection and setup handlers
function createPeerConnection(remotePeerId) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });

  pc.onicecandidate = event => {
    if (event.candidate) {
      sendSignal("ice", remotePeerId, event.candidate);
    }
  };

  pc.ontrack = event => {
    log("📺 Received remote stream");
    friendsVideo.srcObject = event.streams[0];
  };

  return pc;
}

// Start local media and add tracks to peer connection if exists
async function start() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    yourVideo.srcObject = stream;

    if (peerConnection) {
      stream.getTracks().forEach(track => peerConnection.addTrack(track, stream));
    }

    log("📷 Local stream started.");
  } catch (err) {
    log("❌ Failed to get media: " + err.message);
  }
}

// Initiate a call to remote peer
async function initiateCall() {
  const input = document.getElementById("peerIdInput").value.trim();
  if (!input) return alert("Enter a peer ID");

  remoteId = input;
  peerConnection = createPeerConnection(remoteId);

  try {
    const stream = yourVideo.srcObject;
    if (stream) {
      stream.getTracks().forEach(track => peerConnection.addTrack(track, stream));
    } else {
      // If stream not started yet, start and add tracks before offer
      await start();
      yourVideo.srcObject.getTracks().forEach(track => peerConnection.addTrack(track, yourVideo.srcObject));
    }

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    sendSignal("offer", remoteId, offer);
    log(`📤 Sent offer to ${remoteId}`);
  } catch (error) {
    console.error("❌ Failed to create/send offer:", error);
  }
}

// Start local media on page load
start();
