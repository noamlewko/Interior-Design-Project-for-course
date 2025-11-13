const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const multer = require('multer'); // Import multer for handling file uploads
const User = require('./models/User');
const ProjectModel = require('./models/Project');
const OptionModel = require('./models/Option');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');

const app = express();
const port = 3000;

mongoose.connect('mongodb://localhost:27017/interior_design')
    .then(() => console.log('Connected to MongoDB'))
    .catch((err) => console.error('Could not connect to MongoDB', err));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Set up multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});
const upload = multer({ storage: storage });

// Upload image route
app.post('/upload-image', upload.single('image'), (req, res) => {
    try {
        const imagePath = `/uploads/${req.file.filename}`;
        res.json({ imageUrl: imagePath });
    } catch (err) {
        console.error('Error uploading image:', err);
        res.status(500).json({ message: 'Error uploading image' });
    }
});

async function isDesigner(req, res, next) {
    try {
        if (!req.headers.authorization) {
            return res.status(403).json({ message: 'No token provided' });
        }

        const token = req.headers.authorization.split(' ')[1];
        const decoded = jwt.verify(token, 'secret_key');
        const user = await User.findById(decoded.id);

        if (!user || user.role !== 'designer') {
            return res.status(403).json({ message: 'Access denied' });
        }
        req.user = user;
        next();
    } catch (err) {
        console.error('Error in isDesigner middleware:', err);
        res.status(500).json({ message: 'Server error' });
    }
}

async function isAuthenticated(req, res, next) {
    try {
        if (!req.headers.authorization) {
            return res.status(403).json({ message: 'No token provided' });
        }

        const token = req.headers.authorization.split(' ')[1];
        const decoded = jwt.verify(token, 'secret_key');
        const user = await User.findById(decoded.id);

        if (!user) {
            return res.status(403).json({ message: 'Access denied' });
        }
        req.user = user;
        next();
    } catch (err) {
        console.error('Error in isAuthenticated middleware:', err);
        res.status(500).json({ message: 'Server error' });
    }
}

// Registration route
app.post('/api/register', async (req, res) => {
    try {
        const { username, password, role } = req.body;
        const existingUser = await User.findOne({ username });

        if (existingUser) {
            return res.status(400).json({ message: 'Username already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ username, password: hashedPassword, role });
        await user.save();
        
        res.json({ message: 'User registered successfully' });
    } catch (err) {
        console.error('Error in registration:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Login route
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });

        if (!user) {
            return res.status(400).json({ message: 'Invalid username or password' });
        }

        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid username or password' });
        }

        const token = jwt.sign({ id: user._id, role: user.role }, 'secret_key', { expiresIn: '1h' });

        res.json({ message: 'Login successful', token, role: user.role });
    } catch (err) {
        console.error('Error in login:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Project creation route
app.post('/api/projects', isDesigner, async (req, res) => {
    try {
        const { name, startDate, endDate, budget, clientUsername } = req.body;

        const client = await User.findOne({ username: clientUsername });

        if (!client) {
            return res.status(404).json({ message: 'Client not found' });
        }

        const newProject = new ProjectModel({
            name,
            startDate,
            endDate,
            budget,
            clientUsername,
            createdBy: req.user._id, 
            associatedClients: [client._id]
        });

        await newProject.save();

        res.json({ project: newProject });
    } catch (err) {
        console.error('Error creating project:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Project update route
app.put('/api/projects/:id', isDesigner, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, startDate, endDate, budget, clientUsername } = req.body;

        const project = await ProjectModel.findById(id);

        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        project.name = name;
        project.startDate = startDate;
        project.endDate = endDate;
        project.budget = budget;
        project.clientUsername = clientUsername;

        await project.save();

        res.json({ project });
    } catch (err) {
        console.error('Error updating project:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Project deletion route
app.delete('/api/projects/:id', isDesigner, async (req, res) => {
    try {
        const { id } = req.params;
        const project = await ProjectModel.findByIdAndDelete(id);

        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        res.json({ message: 'Project deleted successfully' });
    } catch (err) {
        console.error('Error deleting project:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Fetch projects route
app.get('/api/projects', isAuthenticated, async (req, res) => {
    try {
        const { role, _id } = req.user;
        
        let projects;
        if (role === 'designer') {
            projects = await ProjectModel.find({ createdBy: _id });
        } else if (role === 'client') {
            projects = await ProjectModel.find({ associatedClients: _id });
        }

        if (!projects) {
            return res.status(404).json({ message: 'No projects found' });
        }

        res.json(projects);
    } catch (err) {
        console.error('Error fetching projects:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Fetch single project route
app.get('/api/projects/:id', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const { role, _id } = req.user;

    try {
        let project;
        if (role === 'designer') {
            project = await ProjectModel.findOne({ _id: id, createdBy: _id });
        } else if (role === 'client') {
            project = await ProjectModel.findOne({ _id: id, associatedClients: _id });
        }

        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        res.json(project);
    } catch (error) {
        console.error('Error fetching project:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Fetch options (general options for all projects)
app.get('/api/options', isAuthenticated, async (req, res) => {
    try {
        const options = await OptionModel.find({});
        console.log('Options fetched:', options); 
        res.json(options);
    } catch (err) {
        console.error('Error fetching options:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Save general options route
app.post('/api/options', isDesigner, async (req, res) => {
    try {
        const { designPreferences } = req.body;

        console.log('Received design preferences:', designPreferences); 

        // First, delete existing options to replace them with new ones
        await OptionModel.deleteMany({});
        console.log('Existing options deleted'); 

        // Save each option group to the database
        const savedOptions = [];
        for (const group of designPreferences) {
            for (const option of group.options) {
                const newOption = new OptionModel({ name: option, type: group.topicName });
                await newOption.save();
                savedOptions.push(newOption);
            }
        }

        console.log('Saved options:', savedOptions); 
        res.json({ message: 'Options saved successfully', savedOptions });
    } catch (err) {
        console.error('Error saving options:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Serve the HTML files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/projectDetails', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'projectDetails.html'));
});

app.get('/clientDesignSelection.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'clientDesignSelection.html'));
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
