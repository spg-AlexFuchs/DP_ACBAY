//Daten import speichert in Db

const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const prisma = require('../../prisma/client');

async function importCSV(){
    const filePath = path.join(__dirname, './data/import.csv');
    
    const rows =[];

    return new Promise ((resolve,reject) => {
    fs.createReadStream(filePath)
    .pipe(csv())
    .on("data",(data) => rows.push(data))
    .on("end",async() => {
        try{
            console.log("CSV geladen:", rows.length, "Zeilen");

            await prisma.survey.deleteMany({}); //vorherige Daten löschen

            for (const r of rows){
            //daten zb const officeDays= parseInt(r.office_days) ||0;

            await prisma.survey.create({
                data:{
                    //office_days: officeDays,
                }
            }
               
            );
            }

            console.log("Daten importiert");
            resolve();
        } catch (error){
            console.error("Fehler beim Importieren der CSV:", error);
            reject (error);
        }
    }
)
.on("error",reject);
    });
}
module.exports = importCSV;