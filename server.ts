// // index.ts or server.ts
// import express, { Express, Request, Response, NextFunction } from 'express';
// import bodyParser from 'body-parser';
// import testeRoutes from './src/routes/teste.routes';
// import startSocketServer from './Example/example';

// const app = express();
// const PORT = process.env.PORT || 3000;

// // startSocketServer();
 
// startSocketServer();

// async () => {
//     app.use(bodyParser.urlencoded({ extended: false }));
//     app.use(bodyParser.json());

//     app.use((req: Request, res: Response, next: NextFunction) => {
//     res.header("Access-Control-Allow-Origin", "*");
//     res.header(
//         "Access-Control-Allow-Headers",
//         "Origin, X-Requested-With, Content-Type, Accept, Authorization"
//     );
//     if (req.method === "OPTIONS") {
//         res.header("Access-Control-Allow-Methods", "PUT, POST, PATCH, DELETE, GET");
//         return res.status(200).send({});
//     }
//     next();
//     });

//     app.use('/notificacao', testeRoutes);
//     app.listen(PORT, () => {
//         console.log(`Express server is listening on port ${PORT}`);
//     });
// }

// export default app;
