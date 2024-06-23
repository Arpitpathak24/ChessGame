const express = require("express");
const socket = require("socket.io");
const http = require("http");
const { Chess } = require("chess.js");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = socket(server);

let waitingPlayer = null;
let games = [];  // Array to store games

app.set("view engine", "ejs");
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
    res.render("index", { title: "Chess Game" });
});

io.on("connection", function (socket) {
    console.log("A user connected:", socket.id);

    if (waitingPlayer) {
        // Start a new game with waiting player and current player
        const newGame = {
            white: waitingPlayer,
            black: socket.id,
            chess: new Chess(),
            spectators: [],
        };
        games.push(newGame);
        
        // Notify both players of their roles
        io.to(waitingPlayer).emit("playerRole", "w");
        socket.emit("playerRole", "b");
        
        // Notify both players that they have been paired
        io.to(waitingPlayer).emit("paired", "You have been paired with an opponent. You are playing as White.");
        socket.emit("paired", "You have been paired with an opponent. You are playing as Black.");
        
        // Send initial board state to both players
        io.to(waitingPlayer).emit("boardState", newGame.chess.fen());
        socket.emit("boardState", newGame.chess.fen());
        
        waitingPlayer = null;
    } else {
        waitingPlayer = socket.id;
        socket.emit("waiting", "Waiting for another player to connect...");
    }

    socket.on("disconnect", function () {
        console.log("A user disconnected:", socket.id);
        if (waitingPlayer === socket.id) {
            waitingPlayer = null;
        } else {
            // Remove player from any ongoing game
            games = games.filter(game => {
                if (game.white === socket.id || game.black === socket.id) {
                    if (game.white === socket.id) {
                        io.to(game.black).emit("playerLeft");
                    } else {
                        io.to(game.white).emit("playerLeft");
                    }
                    return false;  // Remove this game
                } else {
                    // Remove disconnected spectator from the game
                    game.spectators = game.spectators.filter(spectator => spectator !== socket.id);
                    return true;
                }
            });
        }
    });

    socket.on("move", (move) => {
        // Find the game this player is in
        const game = games.find(game => game.white === socket.id || game.black === socket.id);
        if (game) {
            try {
                if (game.chess.turn() === "w" && socket.id !== game.white) return;
                if (game.chess.turn() === "b" && socket.id !== game.black) return;
    
                const result = game.chess.move(move);
    
                if (result) {
                    io.to(game.white).emit("move", move);
                    io.to(game.black).emit("move", move);
                    game.spectators.forEach(spectator => io.to(spectator).emit("move", move));
                    io.to(game.white).emit("boardState", game.chess.fen());
                    io.to(game.black).emit("boardState", game.chess.fen());
                    game.spectators.forEach(spectator => io.to(spectator).emit("boardState", game.chess.fen()));
    
                    // Check if the game is over (checkmate or stalemate)
                    if (game.chess.in_checkmate() || game.chess.in_stalemate()) {
                        let message = "";
                        if (game.chess.in_checkmate()) {
                            const winner = game.chess.turn() === "w" ? "Black" : "White";
                            message = `Checkmate! ${winner} wins.`;
                        } else {
                            message = "Stalemate! The game is a draw.";
                        }
                        io.to(game.white).emit("gameOver", message);
                        io.to(game.black).emit("gameOver", message);
                    }
                } else {
                    socket.emit("invalid:move", move);
                }
            } catch (err) {
                console.log(err);
                socket.emit("invalid:move", move);
            }
        } else {
            // If not found in any game, treat as spectator and send them current board state
            const game = games.find(game => game.spectators.includes(socket.id));
            if (game) {
                socket.emit("boardState", game.chess.fen());
            }
        }
    });
    
    

    socket.on("spectate", () => {
        // Assign to the last game as a spectator
        if (games.length > 0) {
            const lastGame = games[games.length - 1];
            lastGame.spectators.push(socket.id);
            socket.emit("spectatorRole");
            socket.emit("boardState", lastGame.chess.fen());
        } else {
            socket.emit("noGame", "No games available to spectate.");
        }
    });
});

server.listen(3000, function () {
    console.log("Server is running on port 3000");
});
