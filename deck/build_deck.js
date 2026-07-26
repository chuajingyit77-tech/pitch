const pptxgen = require("pptxgenjs");
const T = require("./theme");

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
pres.author = "Prospek Cerah project development team";
pres.company = "Prospek Cerah";
pres.title = "Padang Besar Cross-Border Logistics Platform — Project Development Package";

require("./slides_part1")(pres, T);
require("./slides_part2")(pres, T);
require("./slides_part3")(pres, T);

pres.writeFile({ fileName: __dirname + "/Padang_Besar_Project_Development_Package.pptx" }).then(() => {
  console.log("Deck written.");
});
