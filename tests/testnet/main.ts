import {
    findSig,
    MethodCallOptions,
    PubKey,
    toHex,
    bsv,
    SmartContract,
    assert,
    ContractTransaction,
    hash256,
    method,
    prop,
    Sig,
} from 'scrypt-ts'
import { Recallable } from '../../src/contracts/recallable'
import { Identity } from '../../src/contracts/identity'
import { getDefaultSigner, randomPrivateKey, sleep } from '../utils/helper'
import { myPublicKey } from '../utils/privateKey'

// 3 players, alice, bob, and me
// I am the issuer
const [alicePrivateKey, alicePublicKey, ,] = randomPrivateKey()
const signer = getDefaultSigner()
// contract deploy transaction
let deployTx: bsv.Transaction
// last contract calling transaction
let lastCallTx: bsv.Transaction
// contract output index
const atOutputIndex = 0

const satoshisIssued = 10
const satoshisSendToAlice = 7
const satoshisSendToBob = 7
let kyc_deployTx: bsv.Transaction
// last contract calling transaction
let kyc_lastCallTx: bsv.Transaction
// contract output index
const kyc_atOutputIndex = 0

const kyc_satoshisIssued = 10
const kyc_satoshisSendToAlice = 7
const kyc_satoshisSendToBob = 7

async function deploy_kyc() {
    await Identity.compile()

    // I am the issuer, and the first user as well

    const initialInstance = new Identity(PubKey(toHex(myPublicKey)))

    // there is one key in the signer, that is `myPrivateKey` (added by default)
    await initialInstance.connect(getDefaultSigner())

    // I issue 10 re-callable satoshis
    kyc_deployTx = await initialInstance.deploy(kyc_satoshisIssued)
    console.log(`I issue ${kyc_satoshisIssued} kyc_token: ${kyc_deployTx.id}`)

    // the current balance of each player:
    // - me     10 (1 utxo)
    // - alice  0
    // - bob    0
}
async function deploy_Normal() {
    await Recallable.compile()

    // I am the issuer, and the first user as well
    const initialInstance = new Recallable(PubKey(toHex(myPublicKey)))

    // there is one key in the signer, that is `myPrivateKey` (added by default)
    await initialInstance.connect(getDefaultSigner())

    // I issue 10 re-callable satoshis
    deployTx = await initialInstance.deploy(satoshisIssued)
    console.log(`I issue ${satoshisIssued}: ${deployTx.id}`)

    // the current balance of each player:
    // - me     10 (1 utxo)
    // - alice  0
    // - bob    0
}

async function kyc_recoverAfterDeployed() {
    // recover instance from contract deploy transaction

    // create an instance with the data when deploying the contract
    sleep(3)

    const meInstance = Identity.fromTx(kyc_deployTx, atOutputIndex)
    // const meInstance = new Identity(PubKey(toHex(myPublicKey)))
    // sync state from tx

    // connect a signer
    await meInstance.connect(getDefaultSigner())

    // now `meInstance` is good to use
    console.log('Contract `Identity` recovered after deployed')

    // I send 7 to alice, keep 3 left
    const meNextInstance = meInstance.next()

    const aliceNextInstance = meInstance.next()
    aliceNextInstance.userPubKey = PubKey(toHex(alicePublicKey))

    const { tx: transferToAliceTx } = await meInstance.methods.transfer(
        (sigResps) => findSig(sigResps, myPublicKey),
        PubKey(toHex(alicePublicKey)),
        BigInt(kyc_satoshisSendToAlice),
        {
            // sign with the private key corresponding to `myPublicKey` (which is `myPrivateKey` in the signer)
            // since I am the current user
            pubKeyOrAddrToSign: myPublicKey,
            next: [
                {
                    // outputIndex 0: UTXO of alice
                    instance: aliceNextInstance,
                    balance: kyc_satoshisSendToAlice,
                },
                {
                    // outputIndex 1: the change UTXO back to me
                    instance: meNextInstance,
                    balance: kyc_satoshisIssued - kyc_satoshisSendToAlice,
                },
            ],
        } as MethodCallOptions<Identity>
    )
    console.log(
        `I send kyc_token: ${kyc_satoshisSendToAlice} to Alice: ${transferToAliceTx.id}`
    )
    kyc_lastCallTx = transferToAliceTx

    // the current balance of each player:
    // - me     3 (1 utxo)
    // - alice  7 (1 utxo)
    // - bob    0
}

async function kyc_recoverAfterCalled_recoverAfterDeployed() {
    const meInstance = Recallable.fromTx(deployTx, atOutputIndex)
    meInstance.bindTxBuilder('transfer', Recallable.custom_transfer)

    // connect a signer
    await meInstance.connect(getDefaultSigner())

    // now `meInstance` is good to use
    console.log('Contract `Recallable` recovered after deployed')

    // I send 7 to alice, keep 3 left
    const meNextInstance = meInstance.next()

    const aliceNextInstance = meInstance.next()
    aliceNextInstance.userPubKey = PubKey(toHex(alicePublicKey))

    const changeAddress = await meInstance.signer.getDefaultAddress()

    const partialContractTransaction1 = await meInstance.methods.transfer(
        (sigResps) => findSig(sigResps, myPublicKey),
        PubKey(toHex(alicePublicKey)),
        BigInt(satoshisSendToAlice),
        {
            // sign with the private key corresponding to `myPublicKey` (which is `myPrivateKey` in the signer)
            // since I am the current user
            pubKeyOrAddrToSign: myPublicKey,
            changeAddress,
            next: [
                {
                    // outputIndex 0: UTXO of alice
                    instance: aliceNextInstance,
                    balance: satoshisSendToAlice,
                },
                {
                    // outputIndex 1: the change UTXO back to me
                    instance: meNextInstance,
                    balance: satoshisIssued - satoshisSendToAlice,
                },
            ],
            multiContractCall: true,
        } as MethodCallOptions<Recallable>
    )
    // console.log(
    //     `I send ${satoshisSendToAlice} to Alice: ${transferToAliceTx.id}`
    // )

    const aliceInstance = Identity.fromTx(kyc_lastCallTx, atOutputIndex)

    // connect a signer
    await aliceInstance.connect(getDefaultSigner(alicePrivateKey))

    // now `aliceInstance` is good to use

    aliceInstance.bindTxBuilder(
        'transfer',
        (
            current: Identity,
            options: MethodCallOptions<Identity>,
            ...args: any
        ): Promise<ContractTransaction> => {
            if (options.partialContractTransaction) {
                const unSignedTx = options.partialContractTransaction.tx
                    // add contract input
                    .addInput(current.buildContractInput(options.fromUTXO))

                // build outputs of next instances
                const nextOptions = Array.from([options.next || []]).flat()
                const nexts = nextOptions.map((n, idx) => {
                    unSignedTx.addOutput(
                        new bsv.Transaction.Output({
                            script: n.instance.lockingScript,
                            satoshis: n.balance,
                        })
                    )
                    return Object.assign({}, n, { atOutputIndex: idx })
                })

                // build change output
                unSignedTx.change(options.changeAddress)
                return Promise.resolve({
                    tx: unSignedTx,
                    atInputIndex: 0,
                    nexts,
                })
            }

            throw new Error('no partialContractTransaction found')
        }
    )

    // alice sends all the 7 to bob, keeps nothing left
    const bobNextInstance = aliceInstance.next()
    bobNextInstance.userPubKey = PubKey(toHex(alicePublicKey))

    const partialContractTransaction2 = await aliceInstance.methods.transfer(
        (sigResps) => findSig(sigResps, alicePublicKey),
        PubKey(toHex(alicePublicKey)),
        BigInt(kyc_satoshisSendToBob),

        {
            // sign with the private key corresponding to `alicePublicKey` (which is `alicePrivateKey` in the signer)
            // since she is the current user

            pubKeyOrAddrToSign: alicePublicKey,
            next: {
                instance: bobNextInstance,
                balance: kyc_satoshisSendToBob,
                atOutputIndex: 2,
            },
            changeAddress,
            multiContractCall: true,
            partialContractTransaction: partialContractTransaction1,
        } as MethodCallOptions<Identity>
    )

    const { tx: callTx, nexts } = await SmartContract.multiContractCall(
        partialContractTransaction2,
        signer
    )

    console.log('Recallable , identity contract transfer called: ', callTx.id)
}

describe('Deploy Normal token and kyc contract.. ', () => {
    it('should succeed', async () => {
        console.log('Deploy Normal')
        await deploy_Normal()

        console.log('Deploy kyc')
        await deploy_kyc()
        console.log('kyc_recoverAfterDeployed')
        await kyc_recoverAfterDeployed()

        // await recoverAfterDeployed()

        await kyc_recoverAfterCalled_recoverAfterDeployed()
    })
})
