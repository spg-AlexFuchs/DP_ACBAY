const prisma = require("../prisma/prismaClient");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

//const JWT_SECRET = "supersecret"; //EVN Variable ka glaub das braucht man nicht wenn dann unten bei const token nochmal was schreiben

async function loginUser(email, password){
    const user = await prisma.user.findUnique({where:{email}});
    if (!user) return null;

    const valid = await bcrypt.compare(password, user.password);
    if(!valid) return null;

    const token = jwt.sign({userId: user.id, userEmail: user.email});
    return token;
}

async function registerUser(email, password){
    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
        data: {email, password: hashed}
    });
    const token = jwt.sign({userId: user.id, userEmail: user.email});
    return token;
}
module.exports = {loginUser, registerUser};