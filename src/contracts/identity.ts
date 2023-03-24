import {
    assert,
    bsv,
    ContractTransaction,
    hash256,
    method,
    MethodCallOptions,
    prop,
    PubKey,
    Sig,
    SmartContract,
} from 'scrypt-ts'

/**
 * re-callable satoshis demo
 * users can transfer these satoshis as wish, and issuer can recall them back to himself at anytime
 */

export class Identity extends SmartContract {
    // the public key of issuer
    @prop()
    readonly issuerPubKey: PubKey

    // the public key of current user
    @prop(true)
    userPubKey: PubKey
    receiverPubKey: PubKey

    constructor(issuer: PubKey) {
        super(...arguments)
        this.issuerPubKey = issuer
        this.userPubKey = issuer // the first user is the issuer himself
    }

    @method()
    public transfer(
        userSig: Sig, // the current user should provide his signature before transfer
        receiverPubKey: PubKey, // send to
        satoshisSent: bigint // send amount
    ) {
        assert(
            this.userPubKey == receiverPubKey ||
                this.userPubKey == this.issuerPubKey,
            'Identity tokens cant be transfer'
        )

        // total satoshis locked in this contract utxo
        const satoshisTotal = this.ctx.utxo.value
        // require the amount requested to be transferred is valid
        assert(
            satoshisSent > 0 && satoshisSent <= satoshisTotal,
            `invalid value of \`satoshisSent\`, should be greater than 0 and less than or equal to ${satoshisTotal}`
        )

        // require the current user to provide signature before transfer
        assert(
            this.checkSig(userSig, this.userPubKey),
            "user's signature check failed"
        )

        // temp record previous user
        const previousUserPubKey = this.userPubKey

        // construct all the outputs of the method calling tx

        // the output send to `receiver`
        this.userPubKey = receiverPubKey
        let outputs = this.buildStateOutput(satoshisSent)

        // the change output back to previous `user`
        const satoshisLeft = satoshisTotal - satoshisSent
        if (satoshisLeft > 0) {
            this.userPubKey = previousUserPubKey
            outputs += this.buildStateOutput(satoshisLeft)
        }

        // the change output for paying the transaction fee
        if (this.changeAmount > 0) {
            outputs += this.buildChangeOutput()
        }

        // require all of these outputs are actually in the unlocking transaction
        assert(
            hash256(outputs) == this.ctx.hashOutputs,
            'hashOutputs check failed'
        )
    }

    @method()
    public recall(issuerSig: Sig) {
        // require the issuer to provide signature before recall
        assert(
            this.checkSig(issuerSig, this.issuerPubKey),
            "issuer's signature check failed"
        )

        this.userPubKey = this.issuerPubKey
        // the amount is satoshis locked in this UTXO
        let outputs = this.buildStateOutput(this.ctx.utxo.value)

        if (this.changeAmount > 0) {
            outputs += this.buildChangeOutput()
        }

        // require all of these outputs are actually in the unlocking transaction
        assert(
            hash256(outputs) == this.ctx.hashOutputs,
            'hashOutputs check failed'
        )
    }
}
