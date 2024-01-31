import { Router } from "express";
const routes = Router();

import { functionsTeste } from "../controllers/teste.controller"; 
 
routes.post('/cadastro-candidato', functionsTeste.handlNotifyCandidate);
routes.put('/convocacao-candidato',  functionsTeste.handlNotifyCandidate);

export default routes;

