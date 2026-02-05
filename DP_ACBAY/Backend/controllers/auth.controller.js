const {loginUser, registerUser} = require("../services/auth.service");

async function login(req,res){
    const {email, password} = req.body;
    if(!email || !password) return res.status(400).json({error:"Email und Passwort erforderlich"});
try{
    const token = await loginUser(email.password);
    if (!token) return res.status(401).json({error :"Ungültige Anmeldedaten"});
    res.json({token});
}catch (err){
    res.status(500).json({error:err.message});
}
}

async function register(req,res){
    const {email, password} = req.body;
    if(!email || !password) return res.status(400).json({error:"Email und Passwort erforderlich"});
    try{
        const token = await registerUser(email, password);
        res.json({token});
    }catch(err){
        res.status(500).json({error:err.message});
    }
}
module.exports = {login, register};