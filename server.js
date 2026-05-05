const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ============ DATA STORE (In production, use a real database) ============
let users = [
    {
        id: 'u1',
        name: 'Mia Chen',
        email: 'mia@studentlink.edu',
        password: 'pass123',
        profilePic: 'https://i.pravatar.cc/150?img=5',
        bio: 'CS & AI enthusiast',
        online: false
    },
    {
        id: 'u2',
        name: 'Jordan Lee',
        email: 'jordan@studentlink.edu',
        password: 'pass123',
        profilePic: 'https://i.pravatar.cc/150?img=8',
        bio: 'Physics major',
        online: false
    },
    {
        id: 'u3',
        name: 'Alex Rivera',
        email: 'alex@studentlink.edu',
        password: 'pass123',
        profilePic: 'https://i.pravatar.cc/150?img=11',
        bio: 'Design & Math',
        online: false
    }
];

let posts = [
    {
        id: 'p1',
        authorId: 'u1',
        content: 'Starting a study group for Calculus III!',
        mediaType: 'image',
        mediaData: 'https://picsum.photos/id/1015/400/250',
        description: 'Chapter 5: Double Integrals',
        timestamp: Date.now() - 3600000,
        comments: [
            {
                id: 'c1',
                authorId: 'u2',
                text: 'Count me in!',
                timestamp: Date.now() - 1800000
            }
        ]
    },
    {
        id: 'p2',
        authorId: 'u3',
        content: 'Check out this projectile motion simulation',
        mediaType: 'video',
        mediaData: 'https://www.w3schools.com/html/mov_bbb.mp4',
        description: 'Physics Lab Report',
        timestamp: Date.now() - 7200000,
        comments: []
    }
];

// Direct messages: { conversationId: { participants: [], messages: [] } }
let conversations = {};

// WebSocket connections: { userId: ws }
const connections = new Map();

// ============ HELPER FUNCTIONS ============
function getOrCreateConversation(user1Id, user2Id) {
    const participants = [user1Id, user2Id].sort();
    const convId = participants.join('_');

    if (!conversations[convId]) {
        conversations[convId] = {
            id: convId,
            participants: participants,
            messages: []
        };
    }
    return conversations[convId];
}

function getUserById(id) {
    return users.find(u => u.id === id);
}

function broadcastUserStatus(userId, status) {
    const message = JSON.stringify({
        type: 'user_status',
        userId,
        status
    });

    connections.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(message);
        }
    });
}

// ============ REST API ROUTES ============

// Register
app.post('/api/register', (req, res) => {
    const { name, email, password, profilePic, bio } = req.body;

    if (users.find(u => u.email === email)) {
        return res.status(400).json({ error: 'Email already registered' });
    }

    const newUser = {
        id: uuidv4(),
        name,
        email,
        password,
        profilePic: profilePic || '',
        bio: bio || 'Student',
        online: false
    };

    users.push(newUser);

    // Don't send password back
    const { password: _, ...userWithoutPassword } = newUser;
    res.json({ user: userWithoutPassword });
});

// Login
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const user = users.find(u => u.email === email && u.password === password);

    if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const { password: _, ...userWithoutPassword } = user;
    res.json({ user: userWithoutPassword });
});

// Get all users (for discover)
app.get('/api/users', (req, res) => {
    const usersWithoutPasswords = users.map(({ password, ...rest }) => rest);
    res.json({ users: usersWithoutPasswords });
});

// Get posts
app.get('/api/posts', (req, res) => {
    const postsWithAuthors = posts.map(post => ({
        ...post,
        author: getUserById(post.authorId),
        comments: post.comments.map(comment => ({
            ...comment,
            author: getUserById(comment.authorId)
        }))
    }));
    res.json({ posts: postsWithAuthors });
});

// Create post
app.post('/api/posts', (req, res) => {
    const { authorId, content, mediaType, mediaData, description } = req.body;

    const newPost = {
        id: uuidv4(),
        authorId,
        content,
        mediaType: mediaType || '',
        mediaData: mediaData || '',
        description: description || '',
        timestamp: Date.now(),
        comments: []
    };

    posts.unshift(newPost);

    // Broadcast new post to all connected users
    const broadcast = JSON.stringify({
        type: 'new_post',
        post: { ...newPost, author: getUserById(authorId) }
    });

    connections.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(broadcast);
        }
    });

    res.json({ post: newPost });
});

// Add comment to post
app.post('/api/posts/:postId/comments', (req, res) => {
    const { postId } = req.params;
    const { authorId, text } = req.body;

    const post = posts.find(p => p.id === postId);
    if (!post) {
        return res.status(404).json({ error: 'Post not found' });
    }

    const newComment = {
        id: uuidv4(),
        authorId,
        text,
        timestamp: Date.now()
    };

    post.comments.push(newComment);

    // Broadcast updated post
    const broadcast = JSON.stringify({
        type: 'new_comment',
        postId,
        comment: { ...newComment, author: getUserById(authorId) }
    });

    connections.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(broadcast);
        }
    });

    res.json({ comment: newComment });
});

// Get conversations for a user
app.get('/api/conversations/:userId', (req, res) => {
    const { userId } = req.params;

    const userConversations = Object.values(conversations)
        .filter(conv => conv.participants.includes(userId))
        .map(conv => ({
            ...conv,
            otherUser: getUserById(conv.participants.find(p => p !== userId))
        }));

    res.json({ conversations: userConversations });
});

// Get messages for a conversation
app.get('/api/conversations/:convId/messages', (req, res) => {
    const { convId } = req.params;
    const conversation = conversations[convId];

    if (!conversation) {
        return res.json({ messages: [] });
    }

    res.json({ messages: conversation.messages });
});

// ============ WEBSOCKET HANDLING ============
wss.on('connection', (ws) => {
    let userId = null;

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);

            switch (message.type) {
                case 'login':
                    userId = message.userId;
                    connections.set(userId, ws);

                    // Update user online status
                    const user = getUserById(userId);
                    if (user) {
                        user.online = true;
                        broadcastUserStatus(userId, 'online');
                    }

                    // Send current online users to the newly connected user
                    const onlineUsers = users.filter(u => u.online).map(u => u.id);
                    ws.send(JSON.stringify({
                        type: 'online_users',
                        users: onlineUsers
                    }));
                    break;

                case 'send_message':
                    const { recipientId, text } = message;
                    if (!userId || !recipientId) return;

                    const conversation = getOrCreateConversation(userId, recipientId);
                    const newMessage = {
                        id: uuidv4(),
                        senderId: userId,
                        text,
                        timestamp: Date.now()
                    };

                    conversation.messages.push(newMessage);

                    // Send to recipient if online
                    const recipientWs = connections.get(recipientId);
                    if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
                        recipientWs.send(JSON.stringify({
                            type: 'new_message',
                            conversationId: conversation.id,
                            message: {
                                ...newMessage,
                                sender: getUserById(userId)
                            }
                        }));
                    }

                    // Also send back to sender for confirmation
                    ws.send(JSON.stringify({
                        type: 'message_sent',
                        conversationId: conversation.id,
                        message: {
                            ...newMessage,
                            sender: getUserById(userId)
                        }
                    }));
                    break;

                case 'typing':
                    const { conversationId, isTyping } = message;
                    const otherUserId = conversations[conversationId]?.participants.find(p => p !== userId);

                    if (otherUserId) {
                        const otherWs = connections.get(otherUserId);
                        if (otherWs && otherWs.readyState === WebSocket.OPEN) {
                            otherWs.send(JSON.stringify({
                                type: 'user_typing',
                                conversationId,
                                userId,
                                isTyping
                            }));
                        }
                    }
                    break;
            }
        } catch (error) {
            console.error('WebSocket message error:', error);
        }
    });

    ws.on('close', () => {
        if (userId) {
            connections.delete(userId);
            const user = getUserById(userId);
            if (user) {
                user.online = false;
                broadcastUserStatus(userId, 'offline');
            }
        }
    });
});

// ============ START SERVER ============
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 StudentLink server running on http://localhost:${PORT}`);
    console.log(`📡 WebSocket server ready for real-time messaging`);
    console.log(`👥 Default users: mia@studentlink.edu / pass123`);
});