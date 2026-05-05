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

// ============ DATA STORE ============
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
        ],
        likes: ['u1', 'u2'],
        shares: 2
    },
    {
        id: 'p2',
        authorId: 'u3',
        content: 'Check out this projectile motion simulation',
        mediaType: 'video',
        mediaData: 'https://www.w3schools.com/html/mov_bbb.mp4',
        description: 'Physics Lab Report',
        timestamp: Date.now() - 7200000,
        comments: [],
        likes: ['u1'],
        shares: 0
    }
];

// Groups system
let groups = [
    {
        id: 'g1',
        name: 'CS Study Group',
        description: 'Computer Science study sessions and project collaboration',
        creatorId: 'u1',
        members: ['u1', 'u2'],
        posts: [],
        createdAt: Date.now() - 86400000
    }
];

let conversations = {};
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

function getGroupById(id) {
    return groups.find(g => g.id === id);
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

function broadcastToGroup(groupId, message) {
    const group = getGroupById(groupId);
    if (!group) return;

    group.members.forEach(memberId => {
        const memberWs = connections.get(memberId);
        if (memberWs && memberWs.readyState === WebSocket.OPEN) {
            memberWs.send(JSON.stringify(message));
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
        online: false,
        createdAt: Date.now()
    };

    users.push(newUser);

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

// Get all users
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
        comments: [],
        likes: [],
        shares: 0
    };

    posts.unshift(newPost);

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

// Add comment
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

// Like/Unlike post
app.post('/api/posts/:postId/like', (req, res) => {
    const { postId } = req.params;
    const { userId } = req.body;

    const post = posts.find(p => p.id === postId);
    if (!post) {
        return res.status(404).json({ error: 'Post not found' });
    }

    const likeIndex = post.likes.indexOf(userId);
    if (likeIndex > -1) {
        post.likes.splice(likeIndex, 1);
    } else {
        post.likes.push(userId);
    }

    res.json({ likes: post.likes.length, liked: likeIndex === -1 });
});

// Share post
app.post('/api/posts/:postId/share', (req, res) => {
    const { postId } = req.params;
    const post = posts.find(p => p.id === postId);

    if (!post) {
        return res.status(404).json({ error: 'Post not found' });
    }

    post.shares++;
    res.json({ shares: post.shares });
});

// ============ GROUP ROUTES ============

// Get all groups
app.get('/api/groups', (req, res) => {
    const groupsWithDetails = groups.map(group => ({
        ...group,
        creator: getUserById(group.creatorId),
        members: group.members.map(mId => {
            const user = getUserById(mId);
            return user ? { id: user.id, name: user.name, profilePic: user.profilePic } : null;
        }).filter(Boolean),
        memberCount: group.members.length
    }));
    res.json({ groups: groupsWithDetails });
});

// Get single group
app.get('/api/groups/:groupId', (req, res) => {
    const group = getGroupById(req.params.groupId);
    if (!group) {
        return res.status(404).json({ error: 'Group not found' });
    }

    const groupWithDetails = {
        ...group,
        creator: getUserById(group.creatorId),
        members: group.members.map(mId => {
            const user = getUserById(mId);
            return user ? { id: user.id, name: user.name, profilePic: user.profilePic, bio: user.bio } : null;
        }).filter(Boolean),
        posts: group.posts.map(post => ({
            ...post,
            author: getUserById(post.authorId)
        }))
    };

    res.json({ group: groupWithDetails });
});

// Create group
app.post('/api/groups', (req, res) => {
    const { name, description, creatorId } = req.body;

    const newGroup = {
        id: uuidv4(),
        name,
        description: description || '',
        creatorId,
        members: [creatorId],
        posts: [],
        createdAt: Date.now()
    };

    groups.push(newGroup);

    // Broadcast new group
    const broadcast = JSON.stringify({
        type: 'new_group',
        group: { ...newGroup, creator: getUserById(creatorId) }
    });

    connections.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(broadcast);
        }
    });

    res.json({ group: newGroup });
});

// Join group
app.post('/api/groups/:groupId/join', (req, res) => {
    const { groupId } = req.params;
    const { userId } = req.body;

    const group = getGroupById(groupId);
    if (!group) {
        return res.status(404).json({ error: 'Group not found' });
    }

    if (!group.members.includes(userId)) {
        group.members.push(userId);

        // Notify group members
        broadcastToGroup(groupId, {
            type: 'member_joined',
            groupId,
            userId,
            userName: getUserById(userId)?.name
        });
    }

    res.json({ group });
});

// Leave group
app.post('/api/groups/:groupId/leave', (req, res) => {
    const { groupId } = req.params;
    const { userId } = req.body;

    const group = getGroupById(groupId);
    if (!group) {
        return res.status(404).json({ error: 'Group not found' });
    }

    group.members = group.members.filter(id => id !== userId);
    res.json({ group });
});

// Post in group
app.post('/api/groups/:groupId/posts', (req, res) => {
    const { groupId } = req.params;
    const { authorId, content } = req.body;

    const group = getGroupById(groupId);
    if (!group) {
        return res.status(404).json({ error: 'Group not found' });
    }

    const newPost = {
        id: uuidv4(),
        authorId,
        content,
        timestamp: Date.now(),
        comments: [],
        likes: []
    };

    group.posts.unshift(newPost);

    broadcastToGroup(groupId, {
        type: 'new_group_post',
        groupId,
        post: { ...newPost, author: getUserById(authorId) }
    });

    res.json({ post: newPost });
});

// Get conversations
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

                    const user = getUserById(userId);
                    if (user) {
                        user.online = true;
                        broadcastUserStatus(userId, 'online');
                    }

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
    console.log(`👥 Groups: CS Study Group created`);
    console.log(`🤖 AI Chat: Working with OpenRouter API`);
});
