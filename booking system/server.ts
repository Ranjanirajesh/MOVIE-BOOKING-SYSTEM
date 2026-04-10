import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import cors from 'cors';
import bodyParser from 'body-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cinereserve';

// Mongoose Schemas
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: 'user' }
});

const movieSchema = new mongoose.Schema({
  name: { type: String, required: true },
  language: { type: String, required: true },
  showTime: { type: String, required: true },
  availableSeats: { type: Number, required: true },
  image: { type: String },
  description: { type: String },
  seats: { type: [Boolean], default: [] }
});

const bookingSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  movieId: { type: mongoose.Schema.Types.ObjectId, ref: 'Movie', required: true },
  movieName: { type: String, required: true },
  userName: { type: String, required: true },
  seats: { type: [Number], required: true },
  showTime: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Movie = mongoose.model('Movie', movieSchema);
const Booking = mongoose.model('Booking', bookingSchema);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Connect to MongoDB
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Seed initial data if empty
    const userCount = await User.countDocuments();
    if (userCount === 0) {
      const adminPassword = await bcrypt.hash('admin123', 10);
      const testPassword = await bcrypt.hash('user123', 10);
      await User.create([
        { name: 'Admin User', email: 'admin@example.com', password: adminPassword, role: 'admin' },
        { name: 'Test User', email: 'user@example.com', password: testPassword, role: 'user' }
      ]);
      console.log('Seeded initial users');
    }

    const movieCount = await Movie.countDocuments();
    if (movieCount === 0) {
      await Movie.create([
        {
          name: 'Inception',
          language: 'English',
          showTime: '10:00 AM',
          availableSeats: 40,
          image: 'https://picsum.photos/seed/inception/400/600',
          description: 'A thief who steals corporate secrets...',
          seats: Array(40).fill(false)
        },
        {
          name: 'The Dark Knight',
          language: 'English',
          showTime: '02:30 PM',
          availableSeats: 40,
          image: 'https://picsum.photos/seed/darkknight/400/600',
          description: 'Batman vs Joker...',
          seats: Array(40).fill(false)
        }
      ]);
      console.log('Seeded initial movies');
    }
  } catch (err) {
    console.error('MongoDB connection error:', err);
  }

  app.use(cors());
  app.use(bodyParser.json());

  // Auth Middleware
  const authenticateToken = (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
      if (err) return res.sendStatus(403);
      req.user = user;
      next();
    });
  };

  const isAdmin = (req: any, res: any, next: any) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Admin access required' });
    next();
  };

  // Auth Routes
  app.post('/api/auth/register', async (req, res) => {
    const { name, email, password } = req.body;
    try {
      const existingUser = await User.findOne({ email });
      if (existingUser) return res.status(400).json({ message: 'User already exists' });
      
      const hashedPassword = await bcrypt.hash(password, 10);
      const newUser = await User.create({ name, email, password: hashedPassword, role: 'user' });
      
      const token = jwt.sign({ id: newUser._id, email: newUser.email, role: newUser.role, name: newUser.name }, JWT_SECRET);
      res.status(201).json({ token, user: { id: newUser._id, name: newUser.name, email: newUser.email, role: newUser.role } });
    } catch (err) {
      res.status(500).json({ message: 'Registration failed' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    console.log(`Login attempt for: ${email}`);
    try {
      const user = await User.findOne({ email });
      if (!user) {
        console.log(`User not found: ${email}`);
        return res.status(400).json({ message: 'Invalid credentials' });
      }
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        console.log(`Password mismatch for: ${email}`);
        return res.status(400).json({ message: 'Invalid credentials' });
      }
      
      console.log(`Login successful for: ${email}`);
      const token = jwt.sign({ id: user._id, email: user.email, role: user.role, name: user.name }, JWT_SECRET);
      res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
    } catch (err) {
      res.status(500).json({ message: 'Login failed' });
    }
  });

  // Movie Routes (Public)
  app.get('/api/movies', async (req, res) => {
    try {
      const movies = await Movie.find();
      res.json(movies.map(m => ({ ...m.toObject(), id: m._id })));
    } catch (err) {
      res.status(500).json({ message: 'Failed to fetch movies' });
    }
  });

  app.get('/api/movies/:id', async (req, res) => {
    try {
      const movie = await Movie.findById(req.params.id);
      if (movie) res.json({ ...movie.toObject(), id: movie._id });
      else res.status(404).json({ message: 'Movie not found' });
    } catch (err) {
      res.status(500).json({ message: 'Failed to fetch movie' });
    }
  });

  // Movie Routes (Admin Only)
  app.post('/api/movies', authenticateToken, isAdmin, async (req, res) => {
    try {
      const newMovie = await Movie.create({ 
        ...req.body, 
        seats: Array(req.body.availableSeats || 40).fill(false)
      });
      res.status(201).json({ ...newMovie.toObject(), id: newMovie._id });
    } catch (err) {
      res.status(500).json({ message: 'Failed to create movie' });
    }
  });

  app.put('/api/movies/:id', authenticateToken, isAdmin, async (req, res) => {
    try {
      const movie = await Movie.findByIdAndUpdate(req.params.id, req.body, { new: true });
      if (!movie) return res.status(404).json({ message: 'Movie not found' });
      res.json({ ...movie.toObject(), id: movie._id });
    } catch (err) {
      res.status(500).json({ message: 'Failed to update movie' });
    }
  });

  app.delete('/api/movies/:id', authenticateToken, isAdmin, async (req, res) => {
    try {
      await Movie.findByIdAndDelete(req.params.id);
      res.json({ message: 'Movie deleted' });
    } catch (err) {
      res.status(500).json({ message: 'Failed to delete movie' });
    }
  });

  // Booking Routes
  app.post('/api/bookings', authenticateToken, async (req, res) => {
    const { movieId, seats, userName } = req.body;
    try {
      const movie = await Movie.findById(movieId);
      if (!movie) return res.status(404).json({ message: 'Movie not found' });

      // Update seats
      seats.forEach((seatIndex: number) => {
        movie.seats[seatIndex] = true;
      });
      movie.availableSeats -= seats.length;
      movie.markModified('seats');
      await movie.save();

      const newBooking = await Booking.create({
        userId: req.user.id,
        movieId,
        movieName: movie.name,
        userName,
        seats,
        showTime: movie.showTime
      });
      res.status(201).json({ ...newBooking.toObject(), id: newBooking._id });
    } catch (err) {
      res.status(500).json({ message: 'Booking failed' });
    }
  });

  app.get('/api/bookings/my', authenticateToken, async (req, res) => {
    try {
      const userBookings = await Booking.find({ userId: req.user.id });
      res.json(userBookings.map(b => ({ ...b.toObject(), id: b._id })));
    } catch (err) {
      res.status(500).json({ message: 'Failed to fetch bookings' });
    }
  });

  app.delete('/api/bookings/:id', authenticateToken, async (req, res) => {
    try {
      const booking = await Booking.findOne({ _id: req.params.id, userId: req.user.id });
      if (!booking) return res.status(404).json({ message: 'Booking not found' });
      
      const movie = await Movie.findById(booking.movieId);
      if (movie) {
        booking.seats.forEach((seatIndex: number) => {
          movie.seats[seatIndex] = false;
        });
        movie.availableSeats += booking.seats.length;
        movie.markModified('seats');
        await movie.save();
      }

      await Booking.findByIdAndDelete(req.params.id);
      res.json({ message: 'Booking cancelled' });
    } catch (err) {
      res.status(500).json({ message: 'Cancellation failed' });
    }
  });

  // Admin: View all bookings
  app.get('/api/admin/bookings', authenticateToken, isAdmin, async (req, res) => {
    try {
      const allBookings = await Booking.find();
      res.json(allBookings.map(b => ({ ...b.toObject(), id: b._id })));
    } catch (err) {
      res.status(500).json({ message: 'Failed to fetch all bookings' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
