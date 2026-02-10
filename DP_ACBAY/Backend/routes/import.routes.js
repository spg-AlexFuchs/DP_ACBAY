//import routes

const router = require("express").Router();
const importCSV = require("../services/import/csv.import");

router.post("/",async (req,res) => {
    try {
        await importCSV(pool);
        res.json({message: "CSV Import erfolgreich"});
 }catch (err){
    res.status(500).json({error:err.message});
 }
});

module.exports=router;