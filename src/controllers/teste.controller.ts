import { Request, Response, NextFunction } from "express";
import { UserNotifier } from "../Types/UserNotifier";

const handlNotifyCandidate = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userNotifierData: UserNotifier = req.body;
        console.log("Received UserNotifier:", userNotifierData);
        res.status(200).send({
            retorno: {
                status: 200,
                mensagem: 'Enviado pedido de notificação!',
                data: userNotifierData
            }
        });
    } catch (error) {
        console.log(error);
        res.status(500).send({
            retorno: {
                status: 500,
                mensagem: 'Erro ao notificar candidato, tente novamente'
            },
            registros: []
        });
    }
};

export const functionsTeste = { handlNotifyCandidate };
